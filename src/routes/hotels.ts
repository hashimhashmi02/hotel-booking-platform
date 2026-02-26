

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { sendSuccess, sendError } from '../utils/response';
import { authenticate, authorize } from '../middleware/auth';
import { createHotelSchema, addRoomSchema } from '../validators/schemas';

const router = Router();

// ─── POST /api/hotels ──────────────────────────────────────
// Only owners can create hotels
router.post('/', authenticate, authorize('owner'), async (req: Request, res: Response) => {
  try {
    const parsed = createHotelSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 'INVALID_REQUEST', 400);
    }

    const { name, description, city, country, amenities } = parsed.data;
    const ownerId = req.user!.id;
    const id = `hotel_${uuidv4().replace(/-/g, '').substring(0, 10)}`;

    // Prisma create — notice how we pass amenities directly as JSON
    const hotel = await prisma.hotel.create({
      data: {
        id,
        ownerId,
        name,
        description: description || null,
        city,
        country,
        amenities: amenities as any,
      },
    });

    return sendSuccess(res, {
      id: hotel.id,
      ownerId: hotel.ownerId,
      name: hotel.name,
      description: hotel.description,
      city: hotel.city,
      country: hotel.country,
      amenities: hotel.amenities,
      rating: 0.0,
      totalReviews: 0,
    }, 201);
  } catch (err) {
    console.error('Create hotel error:', err);
    return sendError(res, 'INTERNAL_ERROR', 500);
  }
});

// ─── GET /api/hotels ───────────────────────────────────────
// Search hotels with optional filters
// Rules: exclude hotels with no rooms, include minPricePerNight
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { city, country, minPrice, maxPrice, minRating } = req.query;

    // Build a dynamic WHERE clause using Prisma's filter syntax
    const where: any = {
      // Only include hotels that have at least 1 room
      rooms: { some: {} },
    };

    if (city) {
      where.city = { equals: city as string, mode: 'insensitive' };
    }
    if (country) {
      where.country = { equals: country as string, mode: 'insensitive' };
    }
    if (minRating) {
      where.rating = { gte: parseFloat(minRating as string) };
    }

    // Fetch hotels with their rooms
    const hotels = await prisma.hotel.findMany({
      where,
      include: { rooms: true },
    });

    // Now we filter by price + compute minPricePerNight
    // We need to do this in JS because Prisma doesn't support
    // aggregate filtering on relations directly in findMany
    const result = hotels
      .map(hotel => {
        const minPricePerNight = Math.min(
          ...hotel.rooms.map(r => Number(r.pricePerNight))
        );
        return {
          id: hotel.id,
          name: hotel.name,
          description: hotel.description,
          city: hotel.city,
          country: hotel.country,
          amenities: hotel.amenities,
          rating: Number(hotel.rating),
          totalReviews: hotel.totalReviews,
          minPricePerNight,
        };
      })
      .filter(hotel => {
        // Apply price filters after computing minPricePerNight
        if (minPrice && hotel.minPricePerNight < parseFloat(minPrice as string)) return false;
        if (maxPrice && hotel.minPricePerNight > parseFloat(maxPrice as string)) return false;
        return true;
      });

    return sendSuccess(res, result);
  } catch (err) {
    console.error('Get hotels error:', err);
    return sendError(res, 'INTERNAL_ERROR', 500);
  }
});

// ─── GET /api/hotels/:hotelId ──────────────────────────────
// Get hotel details with all rooms
router.get('/:hotelId', authenticate, async (req: Request, res: Response) => {
  try {
    const { hotelId } = req.params;

    // Prisma's `include` is like SQL JOIN — fetch hotel + its rooms
    const hotel = await prisma.hotel.findUnique({
      where: { id: hotelId as string },
      include: { rooms: true },
    });

    if (!hotel) {
      return sendError(res, 'HOTEL_NOT_FOUND', 404);
    }

    return sendSuccess(res, {
      id: hotel.id,
      ownerId: hotel.ownerId,
      name: hotel.name,
      description: hotel.description,
      city: hotel.city,
      country: hotel.country,
      amenities: hotel.amenities,
      rating: Number(hotel.rating),
      totalReviews: hotel.totalReviews,
      rooms: hotel.rooms.map(room => ({
        id: room.id,
        roomNumber: room.roomNumber,
        roomType: room.roomType,
        pricePerNight: Number(room.pricePerNight),
        maxOccupancy: room.maxOccupancy,
      })),
    });
  } catch (err) {
    console.error('Get hotel error:', err);
    return sendError(res, 'INTERNAL_ERROR', 500);
  }
});

// ─── POST /api/hotels/:hotelId/rooms ───────────────────────
// Owner adds a room to their hotel
router.post('/:hotelId/rooms', authenticate, authorize('owner'), async (req: Request, res: Response) => {
  try {
    const { hotelId } = req.params;

    const parsed = addRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 'INVALID_REQUEST', 400);
    }

    // Check hotel exists
    const hotel = await prisma.hotel.findUnique({ where: { id: hotelId as string } });
    if (!hotel) {
      return sendError(res, 'HOTEL_NOT_FOUND', 404);
    }

    // Only the hotel's owner can add rooms
    if (hotel.ownerId !== req.user!.id) {
      return sendError(res, 'FORBIDDEN', 403);
    }

    const { roomNumber, roomType, pricePerNight, maxOccupancy } = parsed.data;

    // Check duplicate room number
    const existingRoom = await prisma.room.findUnique({
      where: {
        hotelId_roomNumber: { hotelId: hotelId as string, roomNumber },
      },
    });
    if (existingRoom) {
      return sendError(res, 'ROOM_ALREADY_EXISTS', 400);
    }

    const id = `room_${uuidv4().replace(/-/g, '').substring(0, 10)}`;

    const room = await prisma.room.create({
      data: {
        id,
        hotelId: hotelId as string,
        roomNumber,
        roomType,
        pricePerNight,
        maxOccupancy,
      },
    });

    return sendSuccess(res, {
      id: room.id,
      hotelId: room.hotelId,
      roomNumber: room.roomNumber,
      roomType: room.roomType,
      pricePerNight: Number(room.pricePerNight),
      maxOccupancy: room.maxOccupancy,
    }, 201);
  } catch (err) {
    console.error('Add room error:', err);
    return sendError(res, 'INTERNAL_ERROR', 500);
  }
});

export default router;
