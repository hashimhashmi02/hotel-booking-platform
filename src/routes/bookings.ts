// src/routes/bookings.ts — Booking Routes (Prisma version)
// ==========================================================
// POST /api/bookings              — Create booking (customer only)
// GET  /api/bookings              — List my bookings (customer only)
// PUT  /api/bookings/:bookingId/cancel — Cancel booking (customer only)
//
// KEY CONCEPTS:
// - Atomic transactions to prevent double-booking (race conditions)
// - Date validation (future dates only)
// - Overlap detection (two bookings can't share the same room on same dates)
// - 24-hour cancellation policy

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../db';
import { sendSuccess, sendError } from '../utils/response';
import { authenticate, authorize } from '../middleware/auth';
import { createBookingSchema } from '../validators/schemas';

const router = Router();

// ─── POST /api/bookings ────────────────────────────────────
// Customer books a room. This is the TRICKIEST endpoint because:
// 1. We must check for overlapping bookings
// 2. Two people booking the same room at the same time = race condition
// 3. We use a Prisma transaction to make it atomic
router.post('/', authenticate, authorize('customer'), async (req: Request, res: Response) => {
  try {
    const parsed = createBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 'INVALID_REQUEST', 400);
    }

    const { roomId, checkInDate, checkOutDate, guests } = parsed.data;
    const userId = req.user!.id;

    // ── Date Validation ──────────────────────────────────
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);

    // Check-out must be after check-in
    if (checkOut <= checkIn) {
      return sendError(res, 'INVALID_REQUEST', 400);
    }

    // Check-in must be in the future (not today or past)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (checkIn <= today) {
      return sendError(res, 'INVALID_DATES', 400);
    }

    // ── Find the room ────────────────────────────────────
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { hotel: true },
    });

    if (!room) {
      return sendError(res, 'ROOM_NOT_FOUND', 404);
    }

    // Owner can't book their own hotel
    if (room.hotel.ownerId === userId) {
      return sendError(res, 'FORBIDDEN', 403);
    }

    // Check guest capacity
    if (guests > room.maxOccupancy) {
      return sendError(res, 'INVALID_CAPACITY', 400);
    }

    // ── Overlap Detection (inside transaction) ───────────
    // We use $transaction to make this atomic.
    // "Atomic" means: either everything succeeds or nothing does.
    // This prevents two people from booking the same room simultaneously.
    const booking = await prisma.$transaction(async (tx) => {
      // Find any confirmed bookings that overlap with requested dates
      const overlapping = await tx.booking.findFirst({
        where: {
          roomId,
          status: 'confirmed',
          // Overlap condition: newCheckIn < existingCheckOut AND newCheckOut > existingCheckIn
          checkInDate: { lt: checkOut },
          checkOutDate: { gt: checkIn },
        },
      });

      if (overlapping) {
        throw new Error('ROOM_NOT_AVAILABLE');
      }

      // Calculate total price
      const nights = Math.round(
        (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)
      );
      const totalPrice = nights * Number(room.pricePerNight);

      // Create the booking
      const id = `booking_${uuidv4().replace(/-/g, '').substring(0, 10)}`;
      return tx.booking.create({
        data: {
          id,
          userId,
          roomId,
          hotelId: room.hotelId,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          guests,
          totalPrice,
          status: 'confirmed',
        },
      });
    });

    return sendSuccess(res, {
      id: booking.id,
      userId: booking.userId,
      roomId: booking.roomId,
      hotelId: booking.hotelId,
      checkInDate: booking.checkInDate.toISOString().split('T')[0],
      checkOutDate: booking.checkOutDate.toISOString().split('T')[0],
      guests: booking.guests,
      totalPrice: Number(booking.totalPrice),
      status: booking.status,
      bookingDate: booking.bookingDate.toISOString(),
    }, 201);
  } catch (err: any) {
    if (err.message === 'ROOM_NOT_AVAILABLE') {
      return sendError(res, 'ROOM_NOT_AVAILABLE', 400);
    }
    console.error('Create booking error:', err);
    return sendError(res, 'INTERNAL_ERROR', 500);
  }
});

// ─── GET /api/bookings ─────────────────────────────────────
// List all bookings for the logged-in customer
// Optional filter: ?status=confirmed or ?status=cancelled
router.get('/', authenticate, authorize('customer'), async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const userId = req.user!.id;

    const where: any = { userId };
    if (status) {
      where.status = status as string;
    }

    // Prisma's `include` lets us fetch related hotel and room data
    // in a single query (like SQL JOIN)
    const bookings = await prisma.booking.findMany({
      where,
      include: {
        hotel: true,
        room: true,
      },
    });

    const result = bookings.map(booking => ({
      id: booking.id,
      roomId: booking.roomId,
      hotelId: booking.hotelId,
      hotelName: booking.hotel.name,
      roomNumber: booking.room.roomNumber,
      roomType: booking.room.roomType,
      checkInDate: booking.checkInDate.toISOString().split('T')[0],
      checkOutDate: booking.checkOutDate.toISOString().split('T')[0],
      guests: booking.guests,
      totalPrice: Number(booking.totalPrice),
      status: booking.status,
      bookingDate: booking.bookingDate.toISOString(),
    }));

    return sendSuccess(res, result);
  } catch (err) {
    console.error('Get bookings error:', err);
    return sendError(res, 'INTERNAL_ERROR', 500);
  }
});

// ─── PUT /api/bookings/:bookingId/cancel ───────────────────
// Cancel a booking (must be 24+ hours before check-in)
router.put('/:bookingId/cancel', authenticate, authorize('customer'), async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user!.id;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      return sendError(res, 'BOOKING_NOT_FOUND', 404);
    }

    // Only the booking owner can cancel
    if (booking.userId !== userId) {
      return sendError(res, 'FORBIDDEN', 403);
    }

    // Already cancelled?
    if (booking.status === 'cancelled') {
      return sendError(res, 'ALREADY_CANCELLED', 400);
    }

    // 24-hour cancellation policy
    const now = new Date();
    const checkIn = new Date(booking.checkInDate);
    const hoursUntilCheckIn = (checkIn.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilCheckIn < 24) {
      return sendError(res, 'CANCELLATION_DEADLINE_PASSED', 400);
    }

    // Cancel the booking
    const cancelledAt = new Date();
    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'cancelled',
        cancelledAt,
      },
    });

    return sendSuccess(res, {
      id: updated.id,
      status: updated.status,
      cancelledAt: updated.cancelledAt!.toISOString(),
    });
  } catch (err) {
    console.error('Cancel booking error:', err);
    return sendError(res, 'INTERNAL_ERROR', 500);
  }
});

export default router;
