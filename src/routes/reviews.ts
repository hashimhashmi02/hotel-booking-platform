import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../db';
import { sendSuccess, sendError } from '../utils/response';
import { authenticate, authorize } from '../middleware/auth';
import { createReviewSchema } from '../validators/schemas';

const router = Router();

// ─── POST /api/reviews ─────────────────────────────────────
router.post('/', authenticate, authorize('customer'), async (req: Request, res: Response) => {
  try {
    const parsed = createReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 'INVALID_REQUEST', 400);
    }

    const { bookingId, rating, comment } = parsed.data;
    const userId = req.user!.id;

    // ── Find the booking ─────────────────────────────────
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      return sendError(res, 'BOOKING_NOT_FOUND', 404);
    }

    // Must be YOUR booking
    if (booking.userId !== userId) {
      return sendError(res, 'FORBIDDEN', 403);
    }

    // ── Check review eligibility ─────────────────────────
    // Must be: checkout date passed AND booking is confirmed
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkOut = new Date(booking.checkOutDate);

    const canReview = checkOut < today && booking.status === 'confirmed';
    if (!canReview) {
      return sendError(res, 'BOOKING_NOT_ELIGIBLE', 400);
    }

    // ── Check if already reviewed ────────────────────────
    const existingReview = await prisma.review.findUnique({
      where: {
        userId_bookingId: { userId, bookingId },
      },
    });
    if (existingReview) {
      return sendError(res, 'ALREADY_REVIEWED', 400);
    }

    // ── Create review + update hotel rating (in a transaction) ──
    const id = `review_${uuidv4().replace(/-/g, '').substring(0, 10)}`;

    const result = await prisma.$transaction(async (tx) => {
      // Create the review
      const review = await tx.review.create({
        data: {
          id,
          userId,
          hotelId: booking.hotelId,
          bookingId,
          rating,
          comment: comment || null,
        },
      });

      // Update hotel rating using the formula from the assignment:
      // newRating = ((oldRating * totalReviews) + newRating) / (totalReviews + 1)
      const hotel = await tx.hotel.findUnique({
        where: { id: booking.hotelId },
      });

      if (hotel) {
        const oldRating = Number(hotel.rating);
        const totalReviews = hotel.totalReviews;
        const newAvgRating = ((oldRating * totalReviews) + rating) / (totalReviews + 1);

        await tx.hotel.update({
          where: { id: booking.hotelId },
          data: {
            rating: Math.round(newAvgRating * 10) / 10, // round to 1 decimal
            totalReviews: totalReviews + 1,
          },
        });
      }

      return review;
    });

    return sendSuccess(res, {
      id: result.id,
      userId: result.userId,
      hotelId: result.hotelId,
      bookingId: result.bookingId,
      rating: result.rating,
      comment: result.comment,
      createdAt: result.createdAt.toISOString(),
    }, 201);
  } catch (err) {
    console.error('Create review error:', err);
    return sendError(res, 'INTERNAL_ERROR', 500);
  }
});

export default router;
