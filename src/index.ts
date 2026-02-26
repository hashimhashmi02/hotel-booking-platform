
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import authRoutes from './routes/auth';
import hotelRoutes from './routes/hotels';
import bookingRoutes from './routes/bookings';
import reviewRoutes from './routes/reviews';

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────
// express.json() parses incoming JSON request bodies
// cors() allows requests from any origin (needed for the test suite)
app.use(express.json());
app.use(cors());

// ─── Routes ────────────────────────────────────────────────
// Each route group handles a section of the API
// The first argument is the "prefix" — e.g., authRoutes handles
// /api/auth/signup and /api/auth/login
app.use('/api/auth', authRoutes);
app.use('/api/hotels', hotelRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/reviews', reviewRoutes);

// ─── Start Server ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
