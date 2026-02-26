// src/validators/schemas.ts — Zod Validation Schemas
// ====================================================
// Zod lets us define the SHAPE of incoming request data.
// If the data doesn't match, we return INVALID_REQUEST.
//
// Why Zod? It gives us:
// 1. Runtime validation (not just TypeScript compile-time)
// 2. Automatic type inference
// 3. Custom error messages

import { z } from 'zod';

// POST /api/auth/signup
export const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
  role: z.enum(['customer', 'owner']).optional().default('customer'),
  phone: z.string().optional(),
});

// POST /api/auth/login
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /api/hotels
export const createHotelSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  city: z.string().min(1),
  country: z.string().min(1),
  amenities: z.array(z.string()).optional().default([]),
});

// POST /api/hotels/:hotelId/rooms
export const addRoomSchema = z.object({
  roomNumber: z.string().min(1),
  roomType: z.string().min(1),
  pricePerNight: z.number().positive(),
  maxOccupancy: z.number().int().positive(),
});

// POST /api/bookings
export const createBookingSchema = z.object({
  roomId: z.string().min(1),
  checkInDate: z.string().min(1),
  checkOutDate: z.string().min(1),
  guests: z.number().int().positive(),
});

// POST /api/reviews
export const createReviewSchema = z.object({
  bookingId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
});
