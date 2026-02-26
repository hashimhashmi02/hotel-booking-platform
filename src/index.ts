
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

app.use(express.json());
app.use(cors());


app.use('/api/auth', authRoutes);
app.use('/api/hotels', hotelRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/reviews', reviewRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
