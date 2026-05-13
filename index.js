const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
require('dotenv').config();
const admin = require('firebase-admin');

// =========================
// Stripe Init (Optional)
// =========================
let stripe = null;
try {
  const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET;
  if (stripeKey && stripeKey !== 'sk_test_xxx') {
    stripe = require('stripe')(stripeKey);
    console.log('✅ Stripe initialized');
  } else {
    console.warn(
      '⚠️ Stripe secret key not configured. Payment features disabled.',
    );
  }
} catch (error) {
  console.warn('⚠️ Stripe initialization failed:', error.message);
}

// Mock stripe for development
if (!stripe) {
  stripe = {
    checkout: {
      sessions: {
        create: async () => ({
          id: 'mock_session_id',
          url: 'http://localhost:5173/payment-success',
        }),
      },
    },
    webhooks: {
      constructEvent: () => ({}),
    },
  };
  console.log('🔧 Using mock Stripe for development');
}

// =========================
// Firebase Admin Init
// =========================
try {
  const decoded = Buffer.from(process.env.FIRE_BASE, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(decoded);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log('✅ Firebase initialized');
} catch (error) {
  console.error('❌ Firebase init error:', error.message);
}

// =========================
// App Setup
// =========================
const app = express();
const port = process.env.PORT || 5000;

// CORS configuration
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://online-tickets-booking-app.web.app',
      'https://your-frontend-vercel-url.vercel.app', // Add your frontend URL
      /\.vercel\.app$/, // Allow all vercel apps
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Email'],
  }),
);
app.use(express.json());

// Request Logger
app.use((req, res, next) => {
  console.log(`📌 ${req.method} ${req.url}`);
  next();
});

// =========================
// Auth Bypass - সব রিকোয়েস্টে এডমিন সেট করুন (ডেভেলপমেন্টের জন্য)
// =========================
// Replace lines 126-136 with this:

// Real Firebase Auth Middleware
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'No token provided',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.token_email = decodedToken.email;
    next();
  } catch (error) {
    console.error('Firebase verification error:', error);
    return res.status(401).json({
      success: false,
      message: 'Invalid token',
    });
  }
};

// Apply middleware to protected routes instead of all routes
app.get('/api/users/me', verifyFirebaseToken, async (req, res) => {
  // Get current user
});

// For development, you can keep a bypass flag
const isDevelopment = process.env.NODE_ENV === 'development';
if (isDevelopment) {
  // Development bypass
  app.use((req, res, next) => {
    req.token_email = req.headers['x-test-email'] || 'admin@ticketbari.com';
    next();
  });
} else {
  // Production - protect routes that need auth
  app.use(
    ['/api/bookings', '/api/users/me', '/api/tickets/vendor'],
    verifyFirebaseToken,
  );
}
// =========================
// MongoDB Connection
// =========================
const username = encodeURIComponent(process.env.DB_USER || '');
const password = encodeURIComponent(process.env.DB_PASS || '');
const uri = `mongodb+srv://${username}:${password}@cluster0.5tiqofx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  maxPoolSize: 10,
  minPoolSize: 0,
  maxIdleTimeMS: 5000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
});

let dbInstance = null;
let isInitialized = false;

async function getDB() {
  if (!dbInstance) {
    await client.connect();
    dbInstance = client.db('ticketbariDB');
    console.log('✅ Connected to MongoDB');
  }
  return dbInstance;
}

function getCollections(db) {
  return {
    usersCollection: db.collection('users'),
    ticketsCollection: db.collection('tickets'),
    bookingsCollection: db.collection('bookings'),
    transactionsCollection: db.collection('transactions'),
    vendorRequestsCollection: db.collection('vendorRequests'),
    vendorProfilesCollection: db.collection('vendorProfiles'),
    userProfilesCollection: db.collection('userProfiles'),
    adminProfilesCollection: db.collection('adminProfiles'),
    reviewsCollection: db.collection('reviews'),
  };
}

async function initializeDB(db) {
  if (isInitialized) return;
  const {
    usersCollection,
    ticketsCollection,
    bookingsCollection,
    transactionsCollection,
    vendorRequestsCollection,
    vendorProfilesCollection,
    userProfilesCollection,
    adminProfilesCollection,
    reviewsCollection,
  } = getCollections(db);

  try {
    const createIndexSafe = async (collection, index, options) => {
      try {
        await collection.createIndex(index, options);
      } catch (err) {
        if (!err.message.includes('already exists')) {
          console.warn('Index warning:', err.message);
        }
      }
    };

    await createIndexSafe(usersCollection, { email: 1 }, { unique: true });
    await createIndexSafe(ticketsCollection, { verificationStatus: 1 });
    await createIndexSafe(ticketsCollection, { vendorEmail: 1 });
    await createIndexSafe(ticketsCollection, { isAdvertised: 1 });
    await createIndexSafe(ticketsCollection, { departureDateTime: 1 });
    await createIndexSafe(bookingsCollection, { userEmail: 1 });
    await createIndexSafe(bookingsCollection, { vendorEmail: 1 });
    await createIndexSafe(bookingsCollection, { status: 1 });
    await createIndexSafe(transactionsCollection, { bookingId: 1 });
    await createIndexSafe(transactionsCollection, { userEmail: 1 });
    await createIndexSafe(vendorRequestsCollection, { userEmail: 1 });
    await createIndexSafe(vendorRequestsCollection, { status: 1 });
    await createIndexSafe(reviewsCollection, { vendorEmail: 1 });
    await createIndexSafe(reviewsCollection, { userEmail: 1 });

    // Default admin
    const adminEmail = 'admin@ticketbari.com';
    const existingAdmin = await usersCollection.findOne({ email: adminEmail });
    if (!existingAdmin) {
      await usersCollection.insertOne({
        email: adminEmail,
        name: 'Super Admin',
        photoURL: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
        role: 'admin',
        isFraud: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log('✅ Default admin created');
    }

    // Profile collections
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    if (!collectionNames.includes('vendorProfiles')) {
      await db.createCollection('vendorProfiles');
      console.log('✅ Created vendorProfiles collection');
    }
    if (!collectionNames.includes('userProfiles')) {
      await db.createCollection('userProfiles');
      console.log('✅ Created userProfiles collection');
    }
    if (!collectionNames.includes('adminProfiles')) {
      await db.createCollection('adminProfiles');
      console.log('✅ Created adminProfiles collection');
    }

    await createIndexSafe(
      vendorProfilesCollection,
      { email: 1 },
      { unique: true },
    );
    await createIndexSafe(
      userProfilesCollection,
      { email: 1 },
      { unique: true },
    );
    await createIndexSafe(
      adminProfilesCollection,
      { email: 1 },
      { unique: true },
    );

    isInitialized = true;
    console.log('✅ DB initialized');
  } catch (err) {
    console.error('DB init error:', err.message);
  }
}

// Middleware: ensure DB is ready
app.use(async (req, res, next) => {
  try {
    const db = await getDB();
    await initializeDB(db);
    req.db = db;
    next();
  } catch (err) {
    console.error('DB connection error:', err.message);
    res
      .status(500)
      .json({ success: false, message: 'Database connection failed' });
  }
});

// =========================
// BASIC ROUTES
// =========================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'TicketBari Server is Running!',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    endpoints: {
      users: '/api/users',
      tickets: '/api/tickets',
      bookings: '/api/bookings',
      admin: '/api/admin',
      payments: '/api/payments',
      vendor: '/api/vendor',
      transactions: '/api/transactions',
    },
  });
});

app.get('/health', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    if (dbInstance) {
      await dbInstance.command({ ping: 1 });
      dbStatus = 'connected';
    }
  } catch (e) {
    dbStatus = 'error';
  }

  res.json({
    success: true,
    message: 'Server is healthy',
    timestamp: new Date(),
    services: {
      database: dbStatus,
      firebase: admin.apps.length > 0 ? 'active' : 'inactive',
      stripe: !!(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET),
    },
  });
});

app.get('/api/test-all', async (req, res) => {
  try {
    const { ticketsCollection, usersCollection, bookingsCollection } =
      getCollections(req.db);
    const ticketsCount = await ticketsCollection.countDocuments();
    const usersCount = await usersCollection.countDocuments();
    const bookingsCount = await bookingsCollection.countDocuments();

    res.json({
      success: true,
      message: 'API is working!',
      database: 'connected',
      stats: {
        tickets: ticketsCount,
        users: usersCount,
        bookings: bookingsCount,
      },
      sampleTickets: await ticketsCollection.find().limit(3).toArray(),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =========================
// DEBUG ROUTES
// =========================
app.get('/api/debug/status', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    database: dbInstance ? 'connected' : 'disconnected',
    firebase: admin.apps.length > 0 ? 'active' : 'inactive',
  });
});

app.get('/api/debug/bookings', async (req, res) => {
  try {
    const { bookingsCollection } = getCollections(req.db);
    const total = await bookingsCollection.countDocuments();
    const sample = await bookingsCollection.find().limit(3).toArray();
    res.json({ success: true, total, sample });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/debug/booking/:id', async (req, res) => {
  try {
    const { bookingsCollection } = getCollections(req.db);
    if (!ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid booking ID' });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' });
    }

    res.json({
      success: true,
      booking: {
        id: booking._id,
        userEmail: booking.userEmail,
        status: booking.status || 'unknown',
        paymentStatus: booking.paymentStatus || 'unknown',
        ticketTitle: booking.ticketTitle,
        totalPrice: booking.totalPrice,
        vendorEmail: booking.vendorEmail,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =========================
// TEST DATA ROUTES
// =========================
app.post('/api/test-data/tickets', async (req, res) => {
  try {
    const { ticketsCollection } = getCollections(req.db);
    await ticketsCollection.deleteMany({});

    const sampleTickets = [
      {
        title: 'Premium Bus Service - Dhaka to Chittagong',
        from: 'Dhaka',
        to: 'Chittagong',
        transportType: 'bus',
        price: 850,
        ticketQuantity: 25,
        departureDateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        perks: ['AC', 'WiFi', 'Water', 'Snacks', 'Charging Port'],
        image: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957',
        vendorEmail: 'vendor1@example.com',
        vendorName: 'Green Line Paribahan',
        verificationStatus: 'approved',
        isAdvertised: true,
        isHidden: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        title: 'Express Train Service - Dhaka to Sylhet',
        from: 'Dhaka',
        to: 'Sylhet',
        transportType: 'train',
        price: 650,
        ticketQuantity: 15,
        departureDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        perks: ['AC', 'Meal', 'Newspaper', 'Blanket'],
        image: 'https://images.unsplash.com/photo-1593642632827-8f8c2b5d0e3f',
        vendorEmail: 'vendor2@example.com',
        vendorName: 'Bangladesh Railway',
        verificationStatus: 'approved',
        isAdvertised: true,
        isHidden: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        title: 'Launch Service - Dhaka to Barisal',
        from: 'Dhaka',
        to: 'Barisal',
        transportType: 'launch',
        price: 450,
        ticketQuantity: 30,
        departureDateTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        perks: ['AC Cabin', 'Food', 'TV', 'Toilet'],
        image: 'https://images.unsplash.com/photo-1566836610-bf8f5c2a4874',
        vendorEmail: 'vendor3@example.com',
        vendorName: 'MV Karnafuly Express',
        verificationStatus: 'approved',
        isAdvertised: false,
        isHidden: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        title: "Air Service - Dhaka to Cox's Bazar",
        from: 'Dhaka',
        to: "Cox's Bazar",
        transportType: 'plane',
        price: 4500,
        ticketQuantity: 8,
        departureDateTime: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        perks: ['Business Class', 'Meal', 'Entertainment', 'Priority'],
        image: 'https://images.unsplash.com/photo-1512295767273-ac109ac3acfa',
        vendorEmail: 'vendor4@example.com',
        vendorName: 'Biman Bangladesh',
        verificationStatus: 'approved',
        isAdvertised: true,
        isHidden: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = await ticketsCollection.insertMany(sampleTickets);
    res.json({
      success: true,
      message: `${result.insertedCount} sample tickets inserted`,
      tickets: result.insertedIds,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: 'Failed to insert test data' });
  }
});

app.post('/api/test/booking/:id/accept', async (req, res) => {
  try {
    const { bookingsCollection } = getCollections(req.db);
    if (!ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid booking ID' });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' });
    }

    await bookingsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: 'accepted', updatedAt: new Date() } },
    );
    res.json({
      success: true,
      message: 'Booking accepted for testing',
      bookingId: req.params.id,
      newStatus: 'accepted',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/test/create-accepted-booking', async (req, res) => {
  try {
    const { ticketsCollection, bookingsCollection, usersCollection } =
      getCollections(req.db);
    const { quantity } = req.body;

    const ticket = await ticketsCollection.findOne({
      verificationStatus: 'approved',
      ticketQuantity: { $gte: quantity || 1 },
    });
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: 'No available tickets found' });
    }

    const user = await usersCollection.findOne({ email: req.token_email });

    const newBooking = {
      ticketId: ticket._id.toString(),
      quantity: quantity || 1,
      userEmail: req.token_email,
      userName: user?.name || 'Test User',
      ticketTitle: ticket.title,
      from: ticket.from,
      to: ticket.to,
      transportType: ticket.transportType,
      unitPrice: ticket.price,
      totalPrice: ticket.price * (quantity || 1),
      departure: ticket.departureDateTime,
      image: ticket.image,
      vendorEmail: ticket.vendorEmail,
      vendorName: ticket.vendorName,
      status: 'accepted',
      paymentStatus: 'unpaid',
      stripeSessionId: null,
      stripePaymentIntentId: null,
      paymentDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await bookingsCollection.insertOne(newBooking);
    await ticketsCollection.updateOne(
      { _id: ticket._id },
      {
        $inc: { ticketQuantity: -(quantity || 1) },
        $set: { updatedAt: new Date() },
      },
    );

    res.status(201).json({
      success: true,
      message: 'Test booking created successfully with accepted status',
      bookingId: result.insertedId,
      booking: {
        id: result.insertedId,
        status: 'accepted',
        paymentStatus: 'unpaid',
        totalPrice: newBooking.totalPrice,
        ticketTitle: newBooking.ticketTitle,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// =========================
// USER ROUTES
// =========================
app.post('/api/users/register', async (req, res) => {
  try {
    const { usersCollection } = getCollections(req.db);
    const { email, name, photoURL } = req.body;

    if (!email || !name) {
      return res
        .status(400)
        .json({ success: false, message: 'Email and name are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid email format' });
    }

    const existingUser = await usersCollection.findOne({
      email: email.toLowerCase(),
    });
    if (existingUser) {
      return res.json({
        success: true,
        message: 'User already exists',
        user: {
          email: existingUser.email,
          name: existingUser.name,
          photoURL: existingUser.photoURL,
          role: existingUser.role,
          isFraud: existingUser.isFraud || false,
        },
      });
    }

    const newUser = {
      email: email.toLowerCase(),
      name: name.trim(),
      photoURL:
        photoURL?.trim() ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
      role: 'user',
      isFraud: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCollection.insertOne(newUser);
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        email: newUser.email,
        name: newUser.name,
        photoURL: newUser.photoURL,
        role: newUser.role,
        isFraud: false,
      },
      insertedId: result.insertedId,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/users/social-login', async (req, res) => {
  try {
    const { usersCollection } = getCollections(req.db);
    const { email, name, photoURL } = req.body;

    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: 'Email is required' });
    }

    let user = await usersCollection.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = {
        email: email.toLowerCase(),
        name: name || email.split('@')[0],
        photoURL:
          photoURL ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(name || email)}&background=random`,
        role: 'user',
        isFraud: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await usersCollection.insertOne(user);
    }

    res.json({
      success: true,
      message: 'User logged in successfully',
      user: {
        email: user.email,
        name: user.name,
        photoURL: user.photoURL,
        role: user.role,
        isFraud: user.isFraud || false,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/users/role/:email', async (req, res) => {
  try {
    const { usersCollection } = getCollections(req.db);
    const email = req.params.email.toLowerCase();

    if (email === 'admin@ticketbari.com') {
      return res.json({ success: true, role: 'admin', isFraud: false });
    }

    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.json({ success: true, role: 'user', isFraud: false });
    }

    res.json({
      success: true,
      role: user.role || 'user',
      isFraud: user.isFraud || false,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/users/:email', async (req, res) => {
  try {
    const { usersCollection } = getCollections(req.db);
    const email = req.params.email.toLowerCase();

    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      email: user.email,
      name: user.name,
      photoURL: user.photoURL,
      role: user.role,
      isFraud: user.isFraud || false,
      createdAt: user.createdAt,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// MAIN USERS API - সব ইউজার পাওয়া
app.get('/api/users', async (req, res) => {
  try {
    const { usersCollection } = getCollections(req.db);
    const users = await usersCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();
    console.log(`✅ Found ${users.length} users`);
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.patch('/api/users/:id/role', async (req, res) => {
  try {
    const { usersCollection } = getCollections(req.db);
    const { role } = req.body;
    const validRoles = ['user', 'vendor', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    await usersCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { role, updatedAt: new Date() } },
    );

    res.json({ success: true, message: `User role updated to ${role}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.patch('/api/users/:id/fraud', async (req, res) => {
  try {
    const { usersCollection, ticketsCollection } = getCollections(req.db);
    const vendor = await usersCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!vendor || vendor.role !== 'vendor') {
      return res
        .status(400)
        .json({ success: false, message: 'User is not a vendor' });
    }

    await usersCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { isFraud: true, updatedAt: new Date() } },
    );

    await ticketsCollection.updateMany(
      { vendorEmail: vendor.email },
      { $set: { isHidden: true, updatedAt: new Date() } },
    );

    res.json({
      success: true,
      message: 'Vendor marked as fraud and all tickets hidden',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const { usersCollection, ticketsCollection, bookingsCollection } =
      getCollections(req.db);
    const user = await usersCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: 'User not found' });
    }
    if (user.email === 'admin@ticketbari.com') {
      return res
        .status(400)
        .json({ success: false, message: 'Cannot delete main admin' });
    }

    await ticketsCollection.deleteMany({ vendorEmail: user.email });
    await bookingsCollection.deleteMany({ userEmail: user.email });
    await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });

    res.json({
      success: true,
      message: 'User and all associated data deleted',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =========================
// TICKET ROUTES
// =========================
app.post('/api/tickets', async (req, res) => {
  try {
    const { usersCollection, ticketsCollection } = getCollections(req.db);
    const ticket = req.body;
    const vendor = await usersCollection.findOne({ email: req.token_email });

    if (!vendor || vendor.role !== 'vendor') {
      return res
        .status(403)
        .json({ success: false, message: 'Vendor access required' });
    }

    if (vendor.isFraud) {
      return res
        .status(403)
        .json({ success: false, message: 'Fraud vendors cannot add tickets' });
    }

    if (
      !ticket.title ||
      !ticket.from ||
      !ticket.to ||
      !ticket.price ||
      !ticket.ticketQuantity ||
      !ticket.departureDateTime
    ) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be filled',
      });
    }

    if (ticket.price <= 0 || ticket.ticketQuantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Price and quantity must be positive numbers',
      });
    }

    const newTicket = {
      title: ticket.title,
      from: ticket.from,
      to: ticket.to,
      transportType: ticket.transportType || 'bus',
      price: parseFloat(ticket.price),
      ticketQuantity: parseInt(ticket.ticketQuantity),
      departureDateTime: new Date(ticket.departureDateTime),
      perks: ticket.perks || [],
      image: ticket.image || '',
      vendorEmail: req.token_email,
      vendorName: vendor.name || 'Vendor',
      verificationStatus: 'pending',
      isAdvertised: false,
      isHidden: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await ticketsCollection.insertOne(newTicket);
    res.status(201).json({
      success: true,
      message: 'Ticket added successfully and pending approval',
      ticketId: result.insertedId,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// সব এপ্রুভড টিকেট (পাবলিক)
app.get('/api/tickets/approved', async (req, res) => {
  try {
    const { ticketsCollection } = getCollections(req.db);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 9;
    const skip = (page - 1) * limit;
    const { from, to, transportType, sort } = req.query;

    let query = {
      verificationStatus: 'approved',
      isHidden: false,
      departureDateTime: { $gte: new Date() },
    };
    if (from) query.from = new RegExp(from, 'i');
    if (to) query.to = new RegExp(to, 'i');
    if (transportType) query.transportType = transportType;

    let sortOption = { createdAt: -1 };
    if (sort === 'lowToHigh') sortOption = { price: 1 };
    if (sort === 'highToLow') sortOption = { price: -1 };
    if (sort === 'departure') sortOption = { departureDateTime: 1 };

    const tickets = await ticketsCollection
      .find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .toArray();
    const total = await ticketsCollection.countDocuments(query);

    res.json({
      success: true,
      tickets,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// এডভার্টাইজড টিকেট (পাবলিক - হোমপেজের জন্য)
app.get('/api/tickets/advertised', async (req, res) => {
  try {
    const { ticketsCollection } = getCollections(req.db);
    const tickets = await ticketsCollection
      .find({
        isAdvertised: true,
        verificationStatus: 'approved',
        isHidden: false,
        departureDateTime: { $gte: new Date() },
      })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    console.log(`✅ Found ${tickets.length} advertised tickets`);
    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/tickets/latest', async (req, res) => {
  try {
    const { ticketsCollection } = getCollections(req.db);
    const tickets = await ticketsCollection
      .find({
        verificationStatus: 'approved',
        isHidden: false,
        departureDateTime: { $gte: new Date() },
      })
      .sort({ createdAt: -1 })
      .limit(8)
      .toArray();

    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// সব টিকেট (এডমিন)
app.get('/api/tickets/admin/all', async (req, res) => {
  try {
    const { ticketsCollection } = getCollections(req.db);
    const tickets = await ticketsCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();
    console.log(`✅ Found ${tickets.length} tickets`);
    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/tickets/vendor/my-tickets', async (req, res) => {
  try {
    const { ticketsCollection } = getCollections(req.db);
    const tickets = await ticketsCollection
      .find({ vendorEmail: req.token_email })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/tickets/:id', async (req, res) => {
  try {
    const { ticketsCollection } = getCollections(req.db);
    if (!ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid ticket ID' });
    }

    const ticket = await ticketsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: 'Ticket not found' });
    }

    res.json({ success: true, ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.patch('/api/tickets/:id', async (req, res) => {
  try {
    const { ticketsCollection } = getCollections(req.db);
    const updates = req.body;

    if (!ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid ticket ID' });
    }

    const ticket = await ticketsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: 'Ticket not found' });
    }

    if (ticket.vendorEmail !== req.token_email) {
      return res
        .status(403)
        .json({ success: false, message: 'Forbidden access' });
    }

    delete updates.verificationStatus;
    delete updates.isAdvertised;
    delete updates.vendorEmail;
    delete updates.vendorName;
    delete updates.createdAt;

    if (updates.departureDateTime)
      updates.departureDateTime = new Date(updates.departureDateTime);
    if (updates.price) updates.price = parseFloat(updates.price);
    if (updates.ticketQuantity)
      updates.ticketQuantity = parseInt(updates.ticketQuantity);
    updates.updatedAt = new Date();

    await ticketsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updates },
    );
    res.json({ success: true, message: 'Ticket updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// টিকেট এপ্রুভ (এডমিন)
app.patch('/api/tickets/:id/approve', async (req, res) => {
  try {
    const { ticketsCollection } = getCollections(req.db);
    const result = await ticketsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { verificationStatus: 'approved', updatedAt: new Date() } },
    );

    if (result.modifiedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: 'Ticket not found' });
    }

    res.json({ success: true, message: 'Ticket approved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// টিকেট রিজেক্ট (এডমিন)
app.patch('/api/tickets/:id/reject', async (req, res) => {
  try {
    const { ticketsCollection } = getCollections(req.db);
    const result = await ticketsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { verificationStatus: 'rejected', updatedAt: new Date() } },
    );

    if (result.modifiedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: 'Ticket not found' });
    }

    res.json({ success: true, message: 'Ticket rejected' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// টিকেট এডভার্টাইজ/প্রোমোট (এডমিন)
app.patch('/api/tickets/:id/advertise', async (req, res) => {
  try {
    const { ticketsCollection } = getCollections(req.db);
    const { isAdvertised } = req.body;

    if (typeof isAdvertised !== 'boolean') {
      return res
        .status(400)
        .json({ success: false, message: 'isAdvertised must be a boolean' });
    }

    if (isAdvertised) {
      const count = await ticketsCollection.countDocuments({
        isAdvertised: true,
        verificationStatus: 'approved',
        isHidden: false,
      });
      if (count >= 6) {
        return res.status(400).json({
          success: false,
          message: 'Maximum 6 tickets can be advertised',
        });
      }
    }

    const result = await ticketsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { isAdvertised, updatedAt: new Date() } },
    );

    if (result.modifiedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: 'Ticket not found' });
    }

    res.json({
      success: true,
      message: isAdvertised
        ? 'Ticket advertised successfully'
        : 'Ticket unadvertised',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// টিকেট ডিলিট
app.delete('/api/tickets/:id', async (req, res) => {
  try {
    const { ticketsCollection, bookingsCollection } = getCollections(req.db);
    if (!ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid ticket ID' });
    }

    const ticket = await ticketsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: 'Ticket not found' });
    }

    const existingBookings = await bookingsCollection.countDocuments({
      ticketId: req.params.id,
      status: { $nin: ['cancelled', 'rejected'] },
    });

    if (existingBookings > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete ticket with active bookings',
      });
    }

    await ticketsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true, message: 'Ticket deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =========================
// BOOKING ROUTES
// =========================
app.post('/api/bookings', async (req, res) => {
  try {
    const { usersCollection, ticketsCollection, bookingsCollection } =
      getCollections(req.db);
    const { ticketId, quantity } = req.body;

    if (!ticketId || !quantity) {
      return res.status(400).json({
        success: false,
        message: 'Ticket ID and quantity are required',
      });
    }
    if (!ObjectId.isValid(ticketId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid ticket ID' });
    }

    const ticket = await ticketsCollection.findOne({
      _id: new ObjectId(ticketId),
    });
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: 'Ticket not found' });
    }
    if (ticket.verificationStatus !== 'approved' || ticket.isHidden) {
      return res
        .status(400)
        .json({ success: false, message: 'Ticket not available for booking' });
    }
    if (ticket.ticketQuantity < quantity) {
      return res
        .status(400)
        .json({ success: false, message: 'Not enough tickets available' });
    }

    const user = await usersCollection.findOne({ email: req.token_email });

    const newBooking = {
      ticketId,
      quantity: parseInt(quantity),
      userEmail: req.token_email,
      userName: user?.name || 'User',
      ticketTitle: ticket.title,
      from: ticket.from,
      to: ticket.to,
      transportType: ticket.transportType,
      unitPrice: ticket.price,
      totalPrice: ticket.price * parseInt(quantity),
      departure: ticket.departureDateTime || ticket.departure,
      image: ticket.image,
      vendorEmail: ticket.vendorEmail,
      vendorName: ticket.vendorName,
      status: 'pending',
      paymentStatus: 'unpaid',
      stripeSessionId: null,
      stripePaymentIntentId: null,
      paymentDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await bookingsCollection.insertOne(newBooking);
    await ticketsCollection.updateOne(
      { _id: new ObjectId(ticketId) },
      {
        $inc: { ticketQuantity: -parseInt(quantity) },
        $set: { updatedAt: new Date() },
      },
    );

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      bookingId: result.insertedId,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/bookings/test', async (req, res) => {
  try {
    const { ticketsCollection, bookingsCollection } = getCollections(req.db);
    const { userEmail, ticketId, quantity } = req.body;

    if (!userEmail || !ticketId || !quantity) {
      return res
        .status(400)
        .json({ success: false, message: 'All fields are required' });
    }

    const ticket = await ticketsCollection.findOne({
      _id: new ObjectId(ticketId),
      verificationStatus: 'approved',
    });
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: 'Ticket not found or not approved' });
    }

    const newBooking = {
      ticketId,
      quantity: parseInt(quantity),
      userEmail,
      userName: userEmail.split('@')[0],
      ticketTitle: ticket.title,
      from: ticket.from,
      to: ticket.to,
      transportType: ticket.transportType,
      unitPrice: ticket.price,
      totalPrice: ticket.price * parseInt(quantity),
      departure: ticket.departureDateTime,
      image: ticket.image,
      vendorEmail: ticket.vendorEmail,
      vendorName: ticket.vendorName,
      status: 'accepted',
      paymentStatus: 'unpaid',
      stripeSessionId: null,
      stripePaymentIntentId: null,
      paymentDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await bookingsCollection.insertOne(newBooking);
    await ticketsCollection.updateOne(
      { _id: new ObjectId(ticketId) },
      {
        $inc: { ticketQuantity: -parseInt(quantity) },
        $set: { updatedAt: new Date() },
      },
    );

    res.status(201).json({
      success: true,
      message: 'Test booking created successfully',
      booking: { id: result.insertedId, ...newBooking },
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: 'Failed to create test booking' });
  }
});

app.get('/api/bookings/my-bookings', async (req, res) => {
  try {
    const { bookingsCollection } = getCollections(req.db);
    const bookings = await bookingsCollection
      .find({ userEmail: req.token_email })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, bookings, count: bookings.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/api/bookings/user/:email', async (req, res) => {
  try {
    const { bookingsCollection } = getCollections(req.db);
    const bookings = await bookingsCollection
      .find({ userEmail: req.params.email })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, bookings, count: bookings.length });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to load bookings',
      error: error.message,
    });
  }
});

app.get('/api/public/bookings/:email', async (req, res) => {
  try {
    const { bookingsCollection } = getCollections(req.db);
    const bookings = await bookingsCollection
      .find({
        userEmail: req.params.email,
        status: { $nin: ['cancelled', 'rejected'] },
      })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, bookings, count: bookings.length });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error while fetching bookings',
      error: error.message,
    });
  }
});

app.get('/api/public/transactions/:email', async (req, res) => {
  try {
    const { transactionsCollection } = getCollections(req.db);
    const transactions = await transactionsCollection
      .find({ userEmail: req.params.email })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, transactions, count: transactions.length });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error while fetching transactions',
      error: error.message,
    });
  }
});

// =========================
// VENDOR BOOKING ROUTES
// =========================
app.get('/api/vendor/bookings/requests', async (req, res) => {
  try {
    const { usersCollection, bookingsCollection } = getCollections(req.db);
    const vendor = await usersCollection.findOne({ email: req.token_email });

    if (!vendor || vendor.role !== 'vendor') {
      return res
        .status(403)
        .json({ success: false, message: 'Vendor access required' });
    }

    const bookingRequests = await bookingsCollection
      .find({ vendorEmail: req.token_email, status: 'pending' })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, bookingRequests, count: bookingRequests.length });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

app.get('/api/vendor/bookings/all', async (req, res) => {
  try {
    const { usersCollection, bookingsCollection } = getCollections(req.db);
    const vendor = await usersCollection.findOne({
      email: req.token_email,
      role: 'vendor',
    });

    if (!vendor) {
      return res
        .status(403)
        .json({ success: false, message: 'Vendor access required' });
    }

    const allBookings = await bookingsCollection
      .find({ vendorEmail: req.token_email })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, allBookings, count: allBookings.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.patch('/api/vendor/bookings/:id/accept', async (req, res) => {
  try {
    const { usersCollection, bookingsCollection } = getCollections(req.db);

    const vendor = await usersCollection.findOne({
      email: req.token_email,
      role: 'vendor',
    });
    if (!vendor) {
      return res
        .status(403)
        .json({ success: false, message: 'Vendor access required' });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(req.params.id),
      vendorEmail: req.token_email,
    });
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' });
    }
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending bookings can be accepted',
      });
    }

    await bookingsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: 'accepted', updatedAt: new Date() } },
    );

    res.json({
      success: true,
      message: 'Booking request accepted successfully',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.patch('/api/vendor/bookings/:id/reject', async (req, res) => {
  try {
    const { usersCollection, bookingsCollection, ticketsCollection } =
      getCollections(req.db);

    const vendor = await usersCollection.findOne({
      email: req.token_email,
      role: 'vendor',
    });
    if (!vendor) {
      return res
        .status(403)
        .json({ success: false, message: 'Vendor access required' });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(req.params.id),
      vendorEmail: req.token_email,
    });
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' });
    }
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending bookings can be rejected',
      });
    }

    await bookingsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: 'rejected', updatedAt: new Date() } },
    );

    if (booking.ticketId && ObjectId.isValid(booking.ticketId)) {
      await ticketsCollection.updateOne(
        { _id: new ObjectId(booking.ticketId) },
        {
          $inc: { ticketQuantity: booking.quantity },
          $set: { updatedAt: new Date() },
        },
      );
    }

    res.json({ success: true, message: 'Booking request rejected' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// =========================
// PAYMENT ROUTES
// =========================
app.post('/api/bookings/:id/pay', async (req, res) => {
  try {
    const { bookingsCollection, transactionsCollection } = getCollections(
      req.db,
    );
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid booking ID' });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(id),
      userEmail: req.token_email,
    });
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' });
    }
    if (booking.paymentStatus === 'paid') {
      return res
        .status(400)
        .json({ success: false, message: 'Booking already paid' });
    }
    if (booking.status !== 'accepted') {
      return res.status(400).json({
        success: false,
        message: 'Booking must be accepted by vendor before payment',
      });
    }

    const transactionId = `TXN${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

    await bookingsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: 'paid',
          paymentStatus: 'paid',
          paymentDate: new Date(),
          transactionId,
          updatedAt: new Date(),
        },
      },
    );

    await transactionsCollection.insertOne({
      transactionId,
      bookingId: id,
      userEmail: req.token_email,
      userName: booking.userName,
      ticketTitle: booking.ticketTitle,
      amount: booking.totalPrice,
      quantity: booking.quantity,
      status: 'completed',
      paymentMethod: 'mock_card',
      paymentDate: new Date(),
      createdAt: new Date(),
      isMock: true,
    });

    res.json({
      success: true,
      message: 'Payment successful!',
      transactionId,
      booking: {
        id,
        status: 'paid',
        paymentStatus: 'paid',
        paymentDate: new Date(),
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: 'Payment failed. Please try again.' });
  }
});

app.post('/api/payments/direct-pay', async (req, res) => {
  try {
    const { ticketsCollection, bookingsCollection, transactionsCollection } =
      getCollections(req.db);
    const { bookingId, userEmail } = req.body;

    if (!bookingId || !userEmail) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID and user email are required',
      });
    }
    if (!ObjectId.isValid(bookingId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid booking ID format' });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(bookingId),
      userEmail,
    });
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or you do not have permission',
      });
    }
    if (booking.paymentStatus === 'paid') {
      return res
        .status(400)
        .json({ success: false, message: 'Booking already paid' });
    }

    const ticket = await ticketsCollection.findOne({
      _id: new ObjectId(booking.ticketId),
    });
    if (!ticket) {
      return res
        .status(400)
        .json({ success: false, message: 'Ticket not found' });
    }

    if (booking.status === 'pending') {
      await bookingsCollection.updateOne(
        { _id: new ObjectId(bookingId) },
        { $set: { status: 'accepted', updatedAt: new Date() } },
      );
    }

    const mockTransactionId = `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await bookingsCollection.updateOne(
      { _id: new ObjectId(bookingId) },
      {
        $set: {
          status: 'paid',
          paymentStatus: 'paid',
          paymentDate: new Date(),
          transactionId: mockTransactionId,
          updatedAt: new Date(),
        },
      },
    );

    await transactionsCollection.insertOne({
      transactionId: mockTransactionId,
      bookingId,
      userEmail,
      userName: booking.userName,
      ticketTitle: booking.ticketTitle,
      amount: booking.totalPrice,
      quantity: booking.quantity,
      status: 'completed',
      paymentMethod: 'mock_card',
      paymentDate: new Date(),
      createdAt: new Date(),
      isMock: true,
    });

    res.json({
      success: true,
      message: 'Mock payment successful!',
      transactionId: mockTransactionId,
      redirectUrl: `${process.env.FRONTEND_URL || 'https://online-tickets-booking-app.web.app'}/dashboard/payment-success?booking_id=${bookingId}&mock=true`,
      isMock: true,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to process payment',
    });
  }
});

app.post('/api/payments/success-callback', async (req, res) => {
  try {
    const { bookingsCollection, transactionsCollection } = getCollections(
      req.db,
    );
    const { bookingId, userEmail, transactionId, amount } = req.body;

    if (!bookingId || !userEmail) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID and user email are required',
      });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(bookingId),
      userEmail,
    });
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' });
    }

    const finalTransactionId =
      transactionId ||
      `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await bookingsCollection.updateOne(
      { _id: new ObjectId(bookingId) },
      {
        $set: {
          status: 'paid',
          paymentStatus: 'paid',
          paymentDate: new Date(),
          transactionId: finalTransactionId,
          updatedAt: new Date(),
        },
      },
    );

    await transactionsCollection.insertOne({
      transactionId: finalTransactionId,
      bookingId,
      userEmail,
      userName: booking.userName,
      ticketTitle: booking.ticketTitle,
      amount: amount || booking.totalPrice,
      quantity: booking.quantity,
      status: 'completed',
      paymentMethod: 'card',
      paymentDate: new Date(),
      createdAt: new Date(),
    });

    res.json({
      success: true,
      message: 'Payment recorded successfully',
      transactionId: finalTransactionId,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: 'Failed to record payment' });
  }
});

// =========================
// TRANSACTIONS ROUTES
// =========================
app.get('/api/transactions/my-transactions', async (req, res) => {
  try {
    const { transactionsCollection, bookingsCollection } = getCollections(
      req.db,
    );
    let transactions = await transactionsCollection
      .find({ userEmail: req.token_email })
      .sort({ createdAt: -1 })
      .toArray();

    if (transactions.length === 0) {
      const paidBookings = await bookingsCollection
        .find({ userEmail: req.token_email, paymentStatus: 'paid' })
        .sort({ paymentDate: -1 })
        .toArray();

      transactions = paidBookings.map(booking => ({
        _id: booking._id,
        transactionId: booking.transactionId || `booking-${booking._id}`,
        bookingId: booking._id.toString(),
        userEmail: booking.userEmail,
        userName: booking.userName,
        ticketTitle: booking.ticketTitle,
        amount: booking.totalPrice,
        quantity: booking.quantity,
        status: 'completed',
        paymentDate: booking.paymentDate || booking.updatedAt,
        createdAt: booking.createdAt,
        isMock: true,
      }));
    }

    res.json({ success: true, transactions, count: transactions.length });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: 'Failed to load transactions' });
  }
});

app.get('/api/transactions/:email', async (req, res) => {
  try {
    const { transactionsCollection } = getCollections(req.db);
    const transactions = await transactionsCollection
      .find({ userEmail: req.params.email })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, transactions, count: transactions.length });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: 'Failed to load transactions' });
  }
});

// =========================
// STRIPE PAYMENT ROUTES
// =========================
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { bookingsCollection } = getCollections(req.db);
    const { bookingId, userEmail } = req.body;

    if (!bookingId || !userEmail) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID and user email are required',
      });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(bookingId),
      userEmail,
    });
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' });
    }
    if (booking.paymentStatus === 'paid') {
      return res
        .status(400)
        .json({ success: false, message: 'Booking already paid' });
    }

    const mockSessionId = `mock_session_${Date.now()}`;
    await bookingsCollection.updateOne(
      { _id: new ObjectId(bookingId) },
      { $set: { stripeSessionId: mockSessionId, updatedAt: new Date() } },
    );

    res.json({
      success: true,
      sessionId: mockSessionId,
      url: `${process.env.FRONTEND_URL || 'https://online-tickets-booking-app.web.app'}/payment?session_id=${mockSessionId}&booking_id=${bookingId}`,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: 'Payment failed to initialize' });
  }
});

app.get('/api/verify-payment/:bookingId', async (req, res) => {
  try {
    const { bookingsCollection } = getCollections(req.db);
    const { bookingId } = req.params;
    const { userEmail } = req.query;

    if (!userEmail) {
      return res
        .status(400)
        .json({ success: false, message: 'User email is required' });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(bookingId),
      userEmail,
    });
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' });
    }

    res.json({
      success: true,
      paid: booking.paymentStatus === 'paid',
      booking: {
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        amount: booking.totalPrice,
        paymentDate: booking.paymentDate,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

// =========================
// VENDOR PROFILE ROUTES
// =========================
app.get('/api/vendors/profile', async (req, res) => {
  try {
    const { usersCollection, vendorProfilesCollection } = getCollections(
      req.db,
    );
    const user = await usersCollection.findOne({ email: req.token_email });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: 'User not found' });
    }

    let vendorProfile = await vendorProfilesCollection.findOne({
      email: req.token_email,
    });
    if (!vendorProfile) {
      vendorProfile = {
        companyName: '',
        contactPerson: user.name || '',
        email: req.token_email,
        phone: '',
        address: '',
        businessType: '',
        taxId: '',
        website: '',
        description: '',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await vendorProfilesCollection.insertOne(vendorProfile);
    }

    res.json({ success: true, vendor: vendorProfile });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

app.put('/api/vendors/profile', async (req, res) => {
  try {
    const { usersCollection, vendorProfilesCollection } = getCollections(
      req.db,
    );
    const {
      companyName,
      contactPerson,
      phone,
      address,
      businessType,
      taxId,
      website,
      description,
    } = req.body;

    if (!companyName || !contactPerson || !phone || !address) {
      return res
        .status(400)
        .json({ success: false, message: 'Please fill all required fields' });
    }

    const user = await usersCollection.findOne({ email: req.token_email });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: 'User not found' });
    }

    if (contactPerson !== user.name) {
      await usersCollection.updateOne(
        { email: req.token_email },
        { $set: { name: contactPerson, updatedAt: new Date() } },
      );
    }

    const vendorData = {
      companyName,
      contactPerson,
      email: req.token_email,
      phone,
      address,
      businessType: businessType || '',
      taxId: taxId || '',
      website: website || '',
      description: description || '',
      status: 'active',
      updatedAt: new Date(),
    };

    const existingProfile = await vendorProfilesCollection.findOne({
      email: req.token_email,
    });
    if (existingProfile) {
      await vendorProfilesCollection.updateOne(
        { email: req.token_email },
        { $set: vendorData },
      );
    } else {
      vendorData.createdAt = new Date();
      await vendorProfilesCollection.insertOne(vendorData);
    }

    res.json({
      success: true,
      message: existingProfile
        ? 'Vendor profile updated successfully'
        : 'Vendor profile created successfully',
      vendor: vendorData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

app.post('/api/vendors/profile', async (req, res) => {
  try {
    const { usersCollection, vendorProfilesCollection } = getCollections(
      req.db,
    );
    const {
      companyName,
      contactPerson,
      phone,
      address,
      businessType,
      taxId,
      website,
      description,
    } = req.body;

    if (!companyName || !contactPerson || !phone || !address) {
      return res
        .status(400)
        .json({ success: false, message: 'Please fill all required fields' });
    }

    const user = await usersCollection.findOne({ email: req.token_email });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: 'User not found' });
    }

    if (user.role !== 'vendor') {
      await usersCollection.updateOne(
        { email: req.token_email },
        { $set: { role: 'vendor', updatedAt: new Date() } },
      );
    }

    const vendorData = {
      companyName,
      contactPerson,
      email: req.token_email,
      phone,
      address,
      businessType: businessType || '',
      taxId: taxId || '',
      website: website || '',
      description: description || '',
      status: 'active',
      updatedAt: new Date(),
    };

    const result = await vendorProfilesCollection.updateOne(
      { email: req.token_email },
      { $set: vendorData },
      { upsert: true },
    );
    if (result.upsertedCount > 0) vendorData.createdAt = new Date();

    res.json({
      success: true,
      message:
        result.upsertedCount > 0
          ? 'Profile created successfully'
          : 'Profile updated successfully',
      vendor: vendorData,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/api/vendors/stats', async (req, res) => {
  try {
    const { usersCollection, ticketsCollection, bookingsCollection } =
      getCollections(req.db);
    const user = await usersCollection.findOne({ email: req.token_email });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: 'User not found' });
    }

    const vendorEmail = req.token_email;
    const totalTickets = await ticketsCollection.countDocuments({
      vendorEmail,
    });
    const vendorBookings = await bookingsCollection
      .find({ vendorEmail })
      .toArray();
    const totalBookings = vendorBookings.length;
    const paidBookings = vendorBookings.filter(
      b => b.paymentStatus === 'paid' || b.status === 'paid',
    );
    const totalRevenue = paidBookings.reduce(
      (sum, b) => sum + (b.totalPrice || 0),
      0,
    );
    const pendingBookings = await bookingsCollection.countDocuments({
      vendorEmail,
      status: 'pending',
    });

    res.json({
      success: true,
      stats: { totalTickets, totalBookings, totalRevenue, pendingBookings },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

app.get('/api/vendors/debug', async (req, res) => {
  try {
    const {
      usersCollection,
      vendorProfilesCollection,
      ticketsCollection,
      bookingsCollection,
    } = getCollections(req.db);
    const user = await usersCollection.findOne({ email: req.token_email });
    const vendorProfile = await vendorProfilesCollection.findOne({
      email: req.token_email,
    });
    const ticketsCount = await ticketsCollection.countDocuments({
      vendorEmail: req.token_email,
    });
    const bookingsCount = await bookingsCollection.countDocuments({
      vendorEmail: req.token_email,
    });

    res.json({
      success: true,
      debug: {
        userExists: !!user,
        userRole: user?.role,
        vendorProfileExists: !!vendorProfile,
        vendorProfile,
        ticketsCount,
        bookingsCount,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =========================
// VENDOR REQUESTS ROUTES (এডমিন)
// =========================
app.post('/api/vendor-requests', async (req, res) => {
  try {
    const { vendorRequestsCollection } = getCollections(req.db);
    const { name, email, phone, address, experience, reason } = req.body;

    if (!name || !email || !phone || !address) {
      return res
        .status(400)
        .json({ success: false, message: 'Please fill all required fields' });
    }

    const existingRequest = await vendorRequestsCollection.findOne({
      userEmail: req.token_email,
      status: 'pending',
    });
    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending vendor request',
      });
    }

    const user = await usersCollection.findOne({ email: req.token_email });
    if (user && user.role === 'vendor') {
      return res
        .status(400)
        .json({ success: false, message: 'You are already a vendor' });
    }

    const newRequest = {
      userEmail: req.token_email,
      name,
      email,
      phone,
      address,
      experience: experience || '',
      reason: reason || '',
      status: 'pending',
      createdAt: new Date(),
    };

    const result = await vendorRequestsCollection.insertOne(newRequest);
    res.status(201).json({
      success: true,
      message: 'Vendor request submitted successfully',
      requestId: result.insertedId,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/api/vendor-requests', async (req, res) => {
  try {
    const { vendorRequestsCollection } = getCollections(req.db);
    const requests = await vendorRequestsCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, requests });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.patch('/api/vendor-requests/:id/approve', async (req, res) => {
  try {
    const { vendorRequestsCollection, usersCollection } = getCollections(
      req.db,
    );
    if (!ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid request ID' });
    }

    const request = await vendorRequestsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!request) {
      return res
        .status(404)
        .json({ success: false, message: 'Request not found' });
    }

    await vendorRequestsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: 'approved', updatedAt: new Date() } },
    );

    await usersCollection.updateOne(
      { email: request.userEmail },
      { $set: { role: 'vendor', updatedAt: new Date() } },
    );

    res.json({
      success: true,
      message: 'Vendor request approved and user role updated',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.patch('/api/vendor-requests/:id/reject', async (req, res) => {
  try {
    const { vendorRequestsCollection } = getCollections(req.db);
    if (!ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid request ID' });
    }

    const request = await vendorRequestsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!request) {
      return res
        .status(404)
        .json({ success: false, message: 'Request not found' });
    }

    await vendorRequestsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: 'rejected', updatedAt: new Date() } },
    );

    res.json({ success: true, message: 'Vendor request rejected' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// =========================
// ADMIN STATS
// =========================
app.get('/api/admin/stats', async (req, res) => {
  try {
    const {
      usersCollection,
      ticketsCollection,
      bookingsCollection,
      transactionsCollection,
    } = getCollections(req.db);

    const totalUsers = await usersCollection.countDocuments();
    const totalVendors = await usersCollection.countDocuments({
      role: 'vendor',
    });
    const totalTickets = await ticketsCollection.countDocuments();
    const pendingTickets = await ticketsCollection.countDocuments({
      verificationStatus: 'pending',
    });
    const totalBookings = await bookingsCollection.countDocuments();

    const revenueResult = await transactionsCollection
      .aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ])
      .toArray();

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalVendors,
        totalTickets,
        pendingTickets,
        totalBookings,
        totalRevenue: revenueResult[0]?.total || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =========================
// VENDOR STATS
// =========================
// =========================
// VENDOR STATS
// =========================
app.get('/api/vendor/stats', async (req, res) => {
  try {
    const { usersCollection, ticketsCollection, bookingsCollection } =
      getCollections(req.db);
    const vendor = await usersCollection.findOne({ email: req.token_email });

    if (!vendor || vendor.role !== 'vendor') {
      return res
        .status(403)
        .json({ success: false, message: 'Vendor access required' });
    }

    const paidBookings = await bookingsCollection
      .find({ vendorEmail: req.token_email, status: 'paid' })
      .toArray();
    const totalRevenue = paidBookings.reduce(
      (sum, b) => sum + (b.totalPrice || 0),
      0,
    );
    const totalTicketsSold = paidBookings.reduce(
      (sum, b) => sum + (b.quantity || 0),
      0,
    );
    const totalTicketsAdded = await ticketsCollection.countDocuments({
      vendorEmail: req.token_email,
    });
    const pendingBookings = await bookingsCollection.countDocuments({
      vendorEmail: req.token_email,
      status: 'pending',
    });

    res.json({
      success: true,
      totalRevenue,
      totalTicketsSold,
      totalTicketsAdded,
      pendingBookings,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
// এডভার্টাইজড টিকেট রাউট
app.get('/api/tickets/advertised', async (req, res) => {
  try {
    const { ticketsCollection } = getCollections(req.db);
    const tickets = await ticketsCollection
      .find({
        isAdvertised: true,
        verificationStatus: 'approved',
        isHidden: false,
        departureDateTime: { $gte: new Date() },
      })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    console.log(`✅ Found ${tickets.length} advertised tickets`);
    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// এপ্রুভড টিকেট রাউট - এই রাউটটি পরিবর্তন করুন
// এপ্রুভড টিকেট রাউট - এই রাউটটি পরিবর্তন করুন
app.get('/api/tickets/approved', async (req, res) => {
  try {
    const { ticketsCollection } = getCollections(req.db);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const skip = (page - 1) * limit;

    let query = { verificationStatus: 'approved', isHidden: false };

    // Location filters
    if (req.query.from) query.from = new RegExp(req.query.from, 'i');
    if (req.query.to) query.to = new RegExp(req.query.to, 'i');

    // Transport type
    if (req.query.transportType && req.query.transportType !== 'all') {
      query.transportType = req.query.transportType;
    }

    // Price range
    if (req.query.minPrice)
      query.price = { ...query.price, $gte: parseInt(req.query.minPrice) };
    if (req.query.maxPrice)
      query.price = { ...query.price, $lte: parseInt(req.query.maxPrice) };

    // Date filter - এই অংশটি পরিবর্তন করুন
    if (req.query.date) {
      const startDate = new Date(req.query.date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(req.query.date);
      endDate.setHours(23, 59, 59, 999);
      query.departureDateTime = { $gte: startDate, $lte: endDate };
    }
    // IMPORTANT: এই ELSE অংশটি সরিয়ে দিন অথবা কমেন্ট করুন
    // else {
    //   query.departureDateTime = { $gte: new Date() };  // ← এই লাইনটি কমেন্ট করুন
    // }

    // Featured filter
    if (req.query.featured === 'true') {
      query.isAdvertised = true;
    }

    // Amenities filter
    if (req.query.amenities) {
      const amenitiesList = req.query.amenities.split(',');
      query.perks = { $all: amenitiesList };
    }

    // Sort option
    let sortOption = { createdAt: -1 };
    if (req.query.sort === 'lowToHigh') sortOption = { price: 1 };
    if (req.query.sort === 'highToLow') sortOption = { price: -1 };
    if (req.query.sort === 'departure') sortOption = { departureDateTime: 1 };

    const tickets = await ticketsCollection
      .find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .toArray();
    const total = await ticketsCollection.countDocuments(query);

    console.log(
      `✅ Found ${tickets.length} approved tickets (total: ${total})`,
    );

    res.json({
      success: true,
      tickets,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    });
  } catch (error) {
    console.error('Error in /api/tickets/approved:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});
// 5. ডিবাগ রাউট - সব টিকেট দেখার জন্য
app.get('/api/debug/all-tickets', async (req, res) => {
  try {
    const tickets = await ticketsCollection.find({}).toArray();
    res.json({
      success: true,
      total: tickets.length,
      tickets: tickets.map(t => ({
        id: t._id,
        title: t.title,
        verificationStatus: t.verificationStatus,
        isAdvertised: t.isAdvertised,
        from: t.from,
        to: t.to,
        price: t.price,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
// =========================
// 404 HANDLER
// =========================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.url} not found`,
  });
});

// =========================
// GLOBAL ERROR HANDLER
// =========================
app.use((error, req, res, next) => {
  console.error('Global error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
});

// =========================
// START SERVER
// =========================
app.listen(port, () => {
  console.log(`\n🚀 Server is running on port ${port}`);
  console.log(`📍 http://localhost:${port}`);
  console.log(`📊 Test API: http://localhost:${port}/api/test-all\n`);
});

module.exports = app;
