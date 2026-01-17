const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
require('dotenv').config();
const admin = require('firebase-admin');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

// =========================
// Firebase Admin Init
// =========================
// index.js
const decoded = Buffer.from(process.env.FIRE_BASE, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// =========================
// App Setup
// =========================
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// =========================
// Firebase Auth Middleware
// =========================
const verifyFireBaseToken = async (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  const token = authorization.split(' ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.token_email = decodedToken.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
};

// =========================
// MongoDB Setup
// =========================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.5tiqofx.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
// =========================
// Routes
// =========================
async function run() {
  try {
    // await client.connect();
    console.log('✅ Connected to MongoDB successfully!');

    const database = client.db('ticketbariDB');
    const usersCollection = database.collection('users');
    const ticketsCollection = database.collection('tickets');
    const bookingsCollection = database.collection('bookings');
    const transactionsCollection = database.collection('transactions');
    const vendorRequestsCollection = database.collection('vendorRequests');

    // // Create indexes
    // await usersCollection.createIndex({ email: 1 }, { unique: true });
    // await ticketsCollection.createIndex({ verificationStatus: 1 });
    // await ticketsCollection.createIndex({ vendorEmail: 1 });
    // await ticketsCollection.createIndex({ isAdvertised: 1 });
    // await ticketsCollection.createIndex({ departureDateTime: 1 });
    // await bookingsCollection.createIndex({ userEmail: 1 });
    // await bookingsCollection.createIndex({ vendorEmail: 1 });
    // await bookingsCollection.createIndex({ status: 1 });
    // await transactionsCollection.createIndex({ bookingId: 1 });
    // await transactionsCollection.createIndex({ userEmail: 1 });

    // ==========================================
    // CREATE DEFAULT ADMIN
    // ==========================================
    const createDefaultAdmin = async () => {
      try {
        const adminEmail = 'admin@ticketbari.com';
        const existingAdmin = await usersCollection.findOne({
          email: adminEmail,
        });

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
          console.log('✅ Default admin created:', adminEmail);
        }
      } catch (error) {
        console.error('Error creating default admin:', error);
      }
    };

    await createDefaultAdmin();

    // ==========================================
    // BASIC ROUTES
    // ==========================================
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
        },
      });
    });

    app.get('/health', (req, res) => {
      res.json({
        success: true,
        message: 'Server is healthy',
        timestamp: new Date(),
        services: {
          database: 'connected',
          firebase: admin.apps.length > 0 ? 'active' : 'inactive',
          stripe: false,
        },
      });
    });

    // ==========================================
    // DEBUG ROUTES
    // ==========================================
    app.get('/api/debug/status', (req, res) => {
      res.json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString(),
        database: client.topology?.isConnected() ? 'connected' : 'disconnected',
        collections: ['users', 'tickets', 'bookings', 'transactions'],
        firebase: admin.apps.length > 0 ? 'active' : 'inactive',
      });
    });

    app.get('/api/debug/bookings', async (req, res) => {
      try {
        const total = await bookingsCollection.countDocuments();
        const sample = await bookingsCollection.find().limit(3).toArray();

        res.json({
          success: true,
          total,
          sample,
          database: 'ticketbariDB',
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error.message,
        });
      }
    });

    app.get('/api/debug/bookings/:email', async (req, res) => {
      try {
        const email = req.params.email;
        console.log(`🔍 Debug: Looking for bookings for ${email}`);

        const bookings = await bookingsCollection
          .find({ userEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        console.log(`📊 Found ${bookings.length} bookings for ${email}`);

        res.json({
          success: true,
          email,
          count: bookings.length,
          bookings: bookings.map(b => ({
            id: b._id,
            ticketTitle: b.ticketTitle,
            status: b.status,
            paymentStatus: b.paymentStatus,
            quantity: b.quantity,
            totalPrice: b.totalPrice,
            createdAt: b.createdAt,
          })),
        });
      } catch (error) {
        console.error('Debug error:', error);
        res.status(500).json({
          success: false,
          message: error.message,
        });
      }
    });

    // ==========================================
    // TEST DATA INSERTION ROUTE
    // ==========================================
    app.post('/api/test-data/tickets', async (req, res) => {
      try {
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
            image:
              'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=500&h=300',
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
            image:
              'https://images.unsplash.com/photo-1593642632827-8f8c2b5d0e3f?auto=format&fit=crop&w=500&h=300',
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
            image:
              'https://images.unsplash.com/photo-1566836610-bf8f5c2a4874?auto=format&fit=crop&w=500&h=300',
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
            image:
              'https://images.unsplash.com/photo-1512295767273-ac109ac3acfa?auto=format&fit=crop&w=500&h=300',
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
        console.error('Error inserting test data:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to insert test data',
        });
      }
    });

    // ==========================================
    // USER ROUTES
    // ==========================================

    // Register/Signup user
    app.post('/api/users/register', async (req, res) => {
      try {
        const { email, name, photoURL } = req.body;

        if (!email || !name) {
          return res.status(400).json({
            success: false,
            message: 'Email and name are required',
          });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid email format',
          });
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
            `https://ui-avatars.com/api/?name=${encodeURIComponent(
              name
            )}&background=random`,
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
        console.error('Registration error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Social login
    app.post('/api/users/social-login', async (req, res) => {
      try {
        const { email, name, photoURL } = req.body;

        if (!email) {
          return res.status(400).json({
            success: false,
            message: 'Email is required',
          });
        }

        const existingUser = await usersCollection.findOne({
          email: email.toLowerCase(),
        });

        if (existingUser) {
          return res.json({
            success: true,
            message: 'User logged in successfully',
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
          name: name || email.split('@')[0],
          photoURL:
            photoURL ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(
              name || email
            )}&background=random`,
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
        console.error('Social login error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Get user role
    app.get('/api/users/role/:email', async (req, res) => {
      try {
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
        console.error('Get role error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Get user profile
    app.get('/api/users/:email', verifyFireBaseToken, async (req, res) => {
      try {
        const email = req.params.email.toLowerCase();

        if (email !== req.token_email) {
          const adminUser = await usersCollection.findOne({
            email: req.token_email,
            role: 'admin',
          });

          if (!adminUser) {
            return res.status(403).json({
              success: false,
              message: 'Access denied',
            });
          }
        }

        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({
            success: false,
            message: 'User not found',
          });
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
        console.error('Get profile error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Get all users (Admin only)
    app.get('/api/users', verifyFireBaseToken, async (req, res) => {
      try {
        const adminUser = await usersCollection.findOne({
          email: req.token_email,
        });

        if (!adminUser || adminUser.role !== 'admin') {
          return res.status(403).json({
            success: false,
            message: 'Admin access required',
          });
        }

        const users = await usersCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();

        res.json({ success: true, users });
      } catch (error) {
        console.error('Get all users error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Update user role (Admin only)
    app.patch('/api/users/:id/role', verifyFireBaseToken, async (req, res) => {
      try {
        const { role } = req.body;

        const adminUser = await usersCollection.findOne({
          email: req.token_email,
        });

        if (!adminUser || adminUser.role !== 'admin') {
          return res.status(403).json({
            success: false,
            message: 'Admin access required',
          });
        }

        const validRoles = ['user', 'vendor', 'admin'];
        if (!validRoles.includes(role)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid role',
          });
        }

        if (role !== 'admin') {
          const userToUpdate = await usersCollection.findOne({
            _id: new ObjectId(req.params.id),
          });

          if (userToUpdate && userToUpdate.email === 'admin@ticketbari.com') {
            return res.status(400).json({
              success: false,
              message: 'Cannot change default admin role',
            });
          }
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { role, updatedAt: new Date() } }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).json({
            success: false,
            message: 'User not found or no changes made',
          });
        }

        res.json({
          success: true,
          message: `User role updated to ${role}`,
        });
      } catch (error) {
        console.error('Update role error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Mark vendor as fraud (Admin only)
    app.patch('/api/users/:id/fraud', verifyFireBaseToken, async (req, res) => {
      try {
        const adminUser = await usersCollection.findOne({
          email: req.token_email,
        });

        if (!adminUser || adminUser.role !== 'admin') {
          return res.status(403).json({
            success: false,
            message: 'Admin access required',
          });
        }

        const vendor = await usersCollection.findOne({
          _id: new ObjectId(req.params.id),
        });

        if (!vendor || vendor.role !== 'vendor') {
          return res.status(400).json({
            success: false,
            message: 'User is not a vendor',
          });
        }

        await usersCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { isFraud: true, updatedAt: new Date() } }
        );

        await ticketsCollection.updateMany(
          { vendorEmail: vendor.email },
          { $set: { isHidden: true, updatedAt: new Date() } }
        );

        res.json({
          success: true,
          message: 'Vendor marked as fraud and all tickets hidden',
        });
      } catch (error) {
        console.error('Mark fraud error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // ==========================================
    // TICKET ROUTES
    // ==========================================

    // Add ticket (Vendor only)
    app.post('/api/tickets', verifyFireBaseToken, async (req, res) => {
      try {
        const ticket = req.body;

        const vendor = await usersCollection.findOne({
          email: req.token_email,
        });

        if (!vendor || vendor.role !== 'vendor') {
          return res.status(403).json({
            success: false,
            message: 'Vendor access required',
          });
        }

        if (vendor.isFraud) {
          return res.status(403).json({
            success: false,
            message: 'Fraud vendors cannot add tickets',
          });
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
        console.error('Add ticket error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Get all approved tickets (Public)
    app.get('/api/tickets/approved', async (req, res) => {
      try {
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
        console.error('Get approved tickets error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Get advertised tickets
    app.get('/api/tickets/advertised', async (req, res) => {
      try {
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

        res.json({ success: true, tickets });
      } catch (error) {
        console.error('Get advertised tickets error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Get latest tickets
    app.get('/api/tickets/latest', async (req, res) => {
      try {
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
        console.error('Get latest tickets error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Get ticket by ID
    app.get('/api/tickets/:id', async (req, res) => {
      try {
        if (!ObjectId.isValid(req.params.id)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid ticket ID',
          });
        }

        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(req.params.id),
        });

        if (!ticket) {
          return res.status(404).json({
            success: false,
            message: 'Ticket not found',
          });
        }

        res.json({ success: true, ticket });
      } catch (error) {
        console.error('Get ticket by ID error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });
    // server.js - Add these routes in the appropriate section

    // ==========================================
    // VENDOR BOOKING REQUESTS ROUTES
    // ==========================================

    // Get all booking requests for a vendor
    // server.js - Update the vendor booking requests route

    // Get all booking requests for a vendor
    app.get(
      '/api/vendor/bookings/requests',

      async (req, res) => {
        try {
          console.log('🔍 VENDOR BOOKINGS REQUEST - Start');
          console.log('Token Email:', req.token_email);
          console.log('Authorization Header:', req.headers.authorization);

          // Check if user is a vendor
          const vendor = await usersCollection.findOne({
            email: req.token_email,
          });

          console.log('Found user:', {
            email: vendor?.email,
            role: vendor?.role,
            exists: !!vendor,
          });

          if (!vendor) {
            console.log('❌ User not found in database');
            return res.status(403).json({
              success: false,
              message: 'User not found',
            });
          }

          if (vendor.role !== 'vendor') {
            console.log('❌ User is not a vendor. Role:', vendor.role);
            return res.status(403).json({
              success: false,
              message: 'Vendor access required. Your role: ' + vendor.role,
            });
          }

          console.log(
            `📋 Fetching booking requests for vendor: ${req.token_email}`
          );

          // Find bookings for this vendor with status 'pending'
          const bookingRequests = await bookingsCollection
            .find({
              vendorEmail: req.token_email,
              status: 'pending',
            })
            .sort({ createdAt: -1 })
            .toArray();

          console.log(`✅ Found ${bookingRequests.length} booking requests`);

          // Log each booking for debugging
          bookingRequests.forEach((booking, index) => {
            console.log(`   Booking ${index + 1}:`, {
              id: booking._id,
              userEmail: booking.userEmail,
              ticketTitle: booking.ticketTitle,
              status: booking.status,
              vendorEmail: booking.vendorEmail,
            });
          });

          res.json({
            success: true,
            bookingRequests,
            count: bookingRequests.length,
            debug: {
              vendorEmail: req.token_email,
              userRole: vendor.role,
            },
          });
        } catch (error) {
          console.error('❌ Get vendor booking requests error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message,
            stack:
              process.env.NODE_ENV === 'development' ? error.stack : undefined,
          });
        }
      }
    );

    // Get all vendor bookings (all statuses)
    app.get(
      '/api/vendor/bookings/all',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          // Check if user is a vendor
          const vendor = await usersCollection.findOne({
            email: req.token_email,
            role: 'vendor',
          });

          if (!vendor) {
            return res.status(403).json({
              success: false,
              message: 'Vendor access required',
            });
          }

          console.log(
            `📋 Fetching all bookings for vendor: ${req.token_email}`
          );

          // Find all bookings for this vendor
          const allBookings = await bookingsCollection
            .find({ vendorEmail: req.token_email })
            .sort({ createdAt: -1 })
            .toArray();

          console.log(`✅ Found ${allBookings.length} total bookings`);

          res.json({
            success: true,
            allBookings,
            count: allBookings.length,
          });
        } catch (error) {
          console.error('Get all vendor bookings error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );

    // Accept booking request (Vendor)
    app.patch(
      '/api/vendor/bookings/:id/accept',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid booking ID',
            });
          }

          // Check if user is a vendor
          const vendor = await usersCollection.findOne({
            email: req.token_email,
            role: 'vendor',
          });

          if (!vendor) {
            return res.status(403).json({
              success: false,
              message: 'Vendor access required',
            });
          }

          const booking = await bookingsCollection.findOne({
            _id: new ObjectId(req.params.id),
            vendorEmail: req.token_email,
          });

          if (!booking) {
            return res.status(404).json({
              success: false,
              message: 'Booking not found',
            });
          }

          if (booking.status !== 'pending') {
            return res.status(400).json({
              success: false,
              message: 'Only pending bookings can be accepted',
            });
          }

          // Update booking status to accepted
          const result = await bookingsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            {
              $set: {
                status: 'accepted',
                updatedAt: new Date(),
              },
            }
          );

          console.log(
            `✅ Booking ${req.params.id} accepted by vendor ${req.token_email}`
          );

          res.json({
            success: true,
            message: 'Booking request accepted successfully',
            bookingId: req.params.id,
          });
        } catch (error) {
          console.error('Accept booking error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );

    // Reject booking request (Vendor)
    app.patch(
      '/api/vendor/bookings/:id/reject',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid booking ID',
            });
          }

          // Check if user is a vendor
          const vendor = await usersCollection.findOne({
            email: req.token_email,
            role: 'vendor',
          });

          if (!vendor) {
            return res.status(403).json({
              success: false,
              message: 'Vendor access required',
            });
          }

          const booking = await bookingsCollection.findOne({
            _id: new ObjectId(req.params.id),
            vendorEmail: req.token_email,
          });

          if (!booking) {
            return res.status(404).json({
              success: false,
              message: 'Booking not found',
            });
          }

          if (booking.status !== 'pending') {
            return res.status(400).json({
              success: false,
              message: 'Only pending bookings can be rejected',
            });
          }

          // Update booking status to rejected
          const result = await bookingsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            {
              $set: {
                status: 'rejected',
                updatedAt: new Date(),
              },
            }
          );

          // Return ticket quantity to available tickets
          if (booking.ticketId && ObjectId.isValid(booking.ticketId)) {
            await ticketsCollection.updateOne(
              { _id: new ObjectId(booking.ticketId) },
              {
                $inc: { ticketQuantity: booking.quantity },
                $set: { updatedAt: new Date() },
              }
            );
          }

          console.log(
            `❌ Booking ${req.params.id} rejected by vendor ${req.token_email}`
          );

          res.json({
            success: true,
            message: 'Booking request rejected',
            bookingId: req.params.id,
          });
        } catch (error) {
          console.error('Reject booking error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );
    // Get vendor's tickets
    app.get(
      '/api/tickets/vendor/my-tickets',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          const vendor = await usersCollection.findOne({
            email: req.token_email,
          });

          if (!vendor || vendor.role !== 'vendor') {
            return res.status(403).json({
              success: false,
              message: 'Vendor access required',
            });
          }

          const tickets = await ticketsCollection
            .find({ vendorEmail: req.token_email })
            .sort({ createdAt: -1 })
            .toArray();

          res.json({ success: true, tickets });
        } catch (error) {
          console.error('Get vendor tickets error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );

    // Update ticket (Vendor)
    app.patch('/api/tickets/:id', verifyFireBaseToken, async (req, res) => {
      try {
        const updates = req.body;

        if (!ObjectId.isValid(req.params.id)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid ticket ID',
          });
        }

        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(req.params.id),
        });

        if (!ticket) {
          return res.status(404).json({
            success: false,
            message: 'Ticket not found',
          });
        }

        if (ticket.vendorEmail !== req.token_email) {
          return res.status(403).json({
            success: false,
            message: 'Forbidden access',
          });
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

        const result = await ticketsCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: updates }
        );

        res.json({
          success: true,
          message: 'Ticket updated successfully',
        });
      } catch (error) {
        console.error('Update ticket error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Delete ticket (Vendor)
    app.delete('/api/tickets/:id', verifyFireBaseToken, async (req, res) => {
      try {
        if (!ObjectId.isValid(req.params.id)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid ticket ID',
          });
        }

        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(req.params.id),
        });

        if (!ticket) {
          return res.status(404).json({
            success: false,
            message: 'Ticket not found',
          });
        }

        if (ticket.vendorEmail !== req.token_email) {
          return res.status(403).json({
            success: false,
            message: 'Forbidden access',
          });
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

        await ticketsCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        });

        res.json({
          success: true,
          message: 'Ticket deleted successfully',
        });
      } catch (error) {
        console.error('Delete ticket error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Get all tickets (Admin only)
    app.get('/api/tickets/admin/all', verifyFireBaseToken, async (req, res) => {
      try {
        const adminUser = await usersCollection.findOne({
          email: req.token_email,
        });

        if (!adminUser || adminUser.role !== 'admin') {
          return res.status(403).json({
            success: false,
            message: 'Admin access required',
          });
        }

        const tickets = await ticketsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();

        res.json({ success: true, tickets });
      } catch (error) {
        console.error('Get all tickets error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Approve ticket (Admin only)
    app.patch(
      '/api/tickets/:id/approve',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          const adminUser = await usersCollection.findOne({
            email: req.token_email,
          });

          if (!adminUser || adminUser.role !== 'admin') {
            return res.status(403).json({
              success: false,
              message: 'Admin access required',
            });
          }

          if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid ticket ID',
            });
          }

          const result = await ticketsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { verificationStatus: 'approved', updatedAt: new Date() } }
          );

          if (result.modifiedCount === 0) {
            return res.status(404).json({
              success: false,
              message: 'Ticket not found',
            });
          }

          res.json({
            success: true,
            message: 'Ticket approved successfully',
          });
        } catch (error) {
          console.error('Approve ticket error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );

    // Reject ticket (Admin only)
    app.patch(
      '/api/tickets/:id/reject',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          const adminUser = await usersCollection.findOne({
            email: req.token_email,
          });

          if (!adminUser || adminUser.role !== 'admin') {
            return res.status(403).json({
              success: false,
              message: 'Admin access required',
            });
          }

          if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid ticket ID',
            });
          }

          const result = await ticketsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { verificationStatus: 'rejected', updatedAt: new Date() } }
          );

          if (result.modifiedCount === 0) {
            return res.status(404).json({
              success: false,
              message: 'Ticket not found',
            });
          }

          res.json({
            success: true,
            message: 'Ticket rejected',
          });
        } catch (error) {
          console.error('Reject ticket error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );

    // Toggle advertise (Admin only)
    app.patch(
      '/api/tickets/:id/advertise',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          const adminUser = await usersCollection.findOne({
            email: req.token_email,
          });

          if (!adminUser || adminUser.role !== 'admin') {
            return res.status(403).json({
              success: false,
              message: 'Admin access required',
            });
          }

          if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid ticket ID',
            });
          }

          const { isAdvertised } = req.body;

          if (typeof isAdvertised !== 'boolean') {
            return res.status(400).json({
              success: false,
              message: 'isAdvertised must be a boolean',
            });
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
            { $set: { isAdvertised, updatedAt: new Date() } }
          );

          if (result.modifiedCount === 0) {
            return res.status(404).json({
              success: false,
              message: 'Ticket not found',
            });
          }

          res.json({
            success: true,
            message: isAdvertised
              ? 'Ticket advertised successfully'
              : 'Ticket unadvertised',
          });
        } catch (error) {
          console.error('Toggle advertise error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );

    // ==========================================
    // BOOKING ROUTES
    // ==========================================
    app.get('/api/bookings/user/:email', async (req, res) => {
      try {
        const userEmail = req.params.email;
        console.log(`📋 Fetching bookings for: ${userEmail}`);

        // Find all bookings for this user
        const bookings = await bookingsCollection
          .find({ userEmail: userEmail })
          .sort({ createdAt: -1 })
          .toArray();

        console.log(`✅ Found ${bookings.length} bookings for ${userEmail}`);

        res.json({
          success: true,
          bookings: bookings,
          count: bookings.length,
        });
      } catch (error) {
        console.error('Error fetching user bookings:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to load bookings',
          error: error.message,
        });
      }
    });

    // Create booking with automatic acceptance for testing
    app.post('/api/bookings/test', async (req, res) => {
      try {
        const { userEmail, ticketId, quantity } = req.body;

        if (!userEmail || !ticketId || !quantity) {
          return res.status(400).json({
            success: false,
            message: 'All fields are required',
          });
        }

        // Find ticket
        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(ticketId),
          verificationStatus: 'approved',
        });

        if (!ticket) {
          return res.status(404).json({
            success: false,
            message: 'Ticket not found or not approved',
          });
        }

        // Create booking with accepted status
        const newBooking = {
          ticketId: ticketId,
          quantity: parseInt(quantity),
          userEmail: userEmail,
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
          status: 'accepted', // Automatically accepted
          paymentStatus: 'unpaid', // Ready for payment
          stripeSessionId: null,
          stripePaymentIntentId: null,
          paymentDate: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await bookingsCollection.insertOne(newBooking);

        // Reduce ticket quantity
        await ticketsCollection.updateOne(
          { _id: new ObjectId(ticketId) },
          {
            $inc: { ticketQuantity: -parseInt(quantity) },
            $set: { updatedAt: new Date() },
          }
        );

        res.status(201).json({
          success: true,
          message: 'Test booking created successfully',
          booking: {
            id: result.insertedId,
            ...newBooking,
          },
        });
      } catch (error) {
        console.error('Test booking error:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to create test booking',
        });
      }
    });

    // PUBLIC BOOKING ROUTES (NO TOKEN REQUIRED)
    app.get('/api/public/bookings/:email', async (req, res) => {
      try {
        const userEmail = req.params.email;

        if (!userEmail) {
          return res.status(400).json({
            success: false,
            message: 'User email is required',
          });
        }

        console.log(`📋 Fetching bookings for user: ${userEmail}`);

        // Find bookings for this user
        const bookings = await bookingsCollection
          .find({
            userEmail: userEmail,
            // Filter out cancelled/rejected bookings if needed
            status: { $nin: ['cancelled', 'rejected'] },
          })
          .sort({ createdAt: -1 })
          .toArray();

        console.log(`✅ Found ${bookings.length} bookings for ${userEmail}`);

        res.json({
          success: true,
          bookings: bookings,
          count: bookings.length,
        });
      } catch (error) {
        console.error('Error fetching user bookings:', error);
        res.status(500).json({
          success: false,
          message: 'Server error while fetching bookings',
          error: error.message,
        });
      }
    });

    // PUBLIC TRANSACTIONS ROUTES (NO TOKEN REQUIRED)
    app.get('/api/public/transactions/:email', async (req, res) => {
      try {
        const userEmail = req.params.email;

        if (!userEmail) {
          return res.status(400).json({
            success: false,
            message: 'User email is required',
          });
        }

        console.log(`📋 Fetching transactions for user: ${userEmail}`);

        const transactions = await transactionsCollection
          .find({
            userEmail: userEmail,
          })
          .sort({ createdAt: -1 })
          .toArray();

        res.json({
          success: true,
          transactions: transactions,
          count: transactions.length,
        });
      } catch (error) {
        console.error('Error fetching user transactions:', error);
        res.status(500).json({
          success: false,
          message: 'Server error while fetching transactions',
          error: error.message,
        });
      }
    });

    // Create Booking (WITH TOKEN)
    app.post('/api/bookings', async (req, res) => {
      try {
        const { ticketId, quantity } = req.body;

        if (!ticketId || !quantity) {
          return res.status(400).json({
            success: false,
            message: 'Ticket ID and quantity are required',
          });
        }

        if (!ObjectId.isValid(ticketId)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid ticket ID',
          });
        }

        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(ticketId),
        });

        if (!ticket) {
          return res.status(404).json({
            success: false,
            message: 'Ticket not found',
          });
        }

        if (ticket.verificationStatus !== 'approved' || ticket.isHidden) {
          return res.status(400).json({
            success: false,
            message: 'Ticket not available for booking',
          });
        }

        if (ticket.ticketQuantity < quantity) {
          return res.status(400).json({
            success: false,
            message: 'Not enough tickets available',
          });
        }

        const user = await usersCollection.findOne({
          email: req.token_email,
        });

        const newBooking = {
          ticketId: ticketId,
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
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await bookingsCollection.insertOne(newBooking);

        await ticketsCollection.updateOne(
          { _id: new ObjectId(ticketId) },
          {
            $inc: { ticketQuantity: -parseInt(quantity) },
            $set: { updatedAt: new Date() },
          }
        );

        res.status(201).json({
          success: true,
          message: 'Booking created successfully',
          bookingId: result.insertedId,
        });
      } catch (error) {
        console.error('Create booking error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Get User's Bookings (WITH TOKEN)
    app.get(
      '/api/bookings/my-bookings',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          console.log('📋 Fetching bookings for:', req.token_email);

          const bookings = await bookingsCollection
            .find({ userEmail: req.token_email })
            .sort({ createdAt: -1 })
            .toArray();

          console.log('✅ Found bookings:', bookings.length);

          res.json({
            success: true,
            bookings,
            count: bookings.length,
          });
        } catch (error) {
          console.error('❌ Get user bookings error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );

    // Simple Payment Route (Mock)
    app.post('/api/bookings/:id/pay', async (req, res) => {
      try {
        const { id } = req.params;
        console.log('💰 Processing payment for booking:', id);

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid booking ID',
          });
        }

        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(id),
          userEmail: req.token_email,
        });

        if (!booking) {
          return res.status(404).json({
            success: false,
            message: 'Booking not found',
          });
        }

        if (booking.paymentStatus === 'paid') {
          return res.status(400).json({
            success: false,
            message: 'Booking already paid',
          });
        }

        if (booking.status !== 'accepted') {
          return res.status(400).json({
            success: false,
            message: 'Booking must be accepted by vendor before payment',
          });
        }

        const transactionId = `TXN${Date.now()}${Math.random()
          .toString(36)
          .substr(2, 9)}`;

        await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: 'paid',
              paymentStatus: 'paid',
              paymentDate: new Date(),
              transactionId: transactionId,
              updatedAt: new Date(),
            },
          }
        );

        await transactionsCollection.insertOne({
          transactionId: transactionId,
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

        console.log('✅ Payment successful for booking:', id);

        res.json({
          success: true,
          message: 'Payment successful!',
          transactionId: transactionId,
          booking: {
            id: id,
            status: 'paid',
            paymentStatus: 'paid',
            paymentDate: new Date(),
          },
        });
      } catch (error) {
        console.error('❌ Payment error:', error);
        res.status(500).json({
          success: false,
          message: 'Payment failed. Please try again.',
        });
      }
    });

    // Create Checkout Session (For compatibility with existing frontend)
    // ==========================================
    // DIRECT STRIPE PAYMENT (NO VENDOR APPROVAL NEEDED)
    // ==========================================
    // ==========================================
    // SIMPLE PAYMENT SUCCESS ROUTE
    // ==========================================

    // Payment success callback
    app.post('/api/payments/success-callback', async (req, res) => {
      try {
        const { bookingId, userEmail, transactionId, amount } = req.body;

        console.log('💰 Payment success callback:', {
          bookingId,
          userEmail,
          transactionId,
        });

        if (!bookingId || !userEmail) {
          return res.status(400).json({
            success: false,
            message: 'Booking ID and user email are required',
          });
        }

        // Find booking
        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(bookingId),
          userEmail: userEmail,
        });

        if (!booking) {
          return res.status(404).json({
            success: false,
            message: 'Booking not found',
          });
        }

        // Generate transaction ID if not provided
        const finalTransactionId =
          transactionId ||
          `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Update booking status to paid
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
          }
        );

        // Create transaction record
        const transactionData = {
          transactionId: finalTransactionId,
          bookingId: bookingId,
          userEmail: userEmail,
          userName: booking.userName,
          ticketTitle: booking.ticketTitle,
          amount: amount || booking.totalPrice,
          quantity: booking.quantity,
          status: 'completed',
          paymentMethod: 'card',
          paymentDate: new Date(),
          createdAt: new Date(),
          stripeMetadata: {
            isStripe: true,
            callback: 'success',
          },
        };

        await transactionsCollection.insertOne(transactionData);

        console.log(`✅ Payment recorded for booking: ${bookingId}`);
        console.log(`✅ Transaction saved: ${finalTransactionId}`);

        res.json({
          success: true,
          message: 'Payment recorded successfully',
          transactionId: finalTransactionId,
          booking: {
            id: bookingId,
            status: 'paid',
            paymentStatus: 'paid',
          },
        });
      } catch (error) {
        console.error('❌ Payment callback error:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to record payment',
        });
      }
    });

    // Get user transactions
    app.get('/api/transactions/:email', async (req, res) => {
      try {
        const userEmail = req.params.email;

        console.log(`📋 Fetching transactions for: ${userEmail}`);

        const transactions = await transactionsCollection
          .find({ userEmail: userEmail })
          .sort({ createdAt: -1 })
          .toArray();

        console.log(
          `✅ Found ${transactions.length} transactions for ${userEmail}`
        );

        res.json({
          success: true,
          transactions: transactions,
          count: transactions.length,
        });
      } catch (error) {
        console.error('❌ Get transactions error:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to load transactions',
        });
      }
    });

    // Also update the direct-pay route to save transaction immediately for mock payments
    // Direct payment without vendor approval
    // ==========================================
    // DIRECT PAYMENT ROUTE (NO APPROVAL NEEDED)
    // ==========================================

    app.post('/api/payments/direct-pay', async (req, res) => {
      try {
        console.log('📩 Direct payment request received');
        const { bookingId, userEmail } = req.body;

        console.log('Request body:', { bookingId, userEmail });

        if (!bookingId || !userEmail) {
          return res.status(400).json({
            success: false,
            message: 'Booking ID and user email are required',
          });
        }

        if (!ObjectId.isValid(bookingId)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid booking ID format',
          });
        }

        console.log(
          '🔍 Looking for booking:',
          bookingId,
          'for user:',
          userEmail
        );

        // Find booking
        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(bookingId),
          userEmail: userEmail,
        });

        console.log('Booking found:', !!booking);

        if (booking) {
          console.log('Booking details:', {
            status: booking.status,
            paymentStatus: booking.paymentStatus,
            totalPrice: booking.totalPrice,
            ticketTitle: booking.ticketTitle,
          });
        }

        if (!booking) {
          return res.status(404).json({
            success: false,
            message: 'Booking not found or you do not have permission',
          });
        }

        if (booking.paymentStatus === 'paid') {
          return res.status(400).json({
            success: false,
            message: 'Booking already paid',
          });
        }

        // Check if ticket is available
        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(booking.ticketId),
        });

        if (!ticket) {
          return res.status(400).json({
            success: false,
            message: 'Ticket not found',
          });
        }

        // 1. FIRST: Check if booking needs to be accepted
        if (booking.status === 'pending') {
          console.log('⏳ Auto-accepting pending booking...');
          await bookingsCollection.updateOne(
            { _id: new ObjectId(bookingId) },
            {
              $set: {
                status: 'accepted',
                updatedAt: new Date(),
              },
            }
          );
          console.log('✅ Booking auto-accepted');
        }

        // 2. SECOND: If Stripe is not configured, use mock payment
        if (
          !process.env.STRIPE_SECRET ||
          process.env.STRIPE_SECRET === 'sk_test_xxx'
        ) {
          console.log('💳 Using mock payment (Stripe not configured)');

          const mockTransactionId = `mock_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;

          // Update booking to paid
          const updateResult = await bookingsCollection.updateOne(
            { _id: new ObjectId(bookingId) },
            {
              $set: {
                status: 'paid',
                paymentStatus: 'paid',
                paymentDate: new Date(),
                transactionId: mockTransactionId,
                updatedAt: new Date(),
              },
            }
          );

          console.log('Booking update result:', updateResult);

          // Create transaction record
          await transactionsCollection.insertOne({
            transactionId: mockTransactionId,
            bookingId: bookingId,
            userEmail: userEmail,
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

          console.log('✅ Mock payment successful');

          return res.json({
            success: true,
            message: 'Mock payment successful!',
            transactionId: mockTransactionId,
            redirectUrl: `${
              process.env.FRONTEND_URL || 'http://localhost:5173'
            }/dashboard/payment-success?booking_id=${bookingId}&mock=true`,
            isMock: true,
          });
        }

        // 3. THIRD: If Stripe IS configured, create real session
        console.log('💳 Creating Stripe session with real credentials');

        try {
          const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
              {
                price_data: {
                  currency: 'bdt',
                  product_data: {
                    name: booking.ticketTitle,
                    description: `${booking.from} to ${booking.to} - ${booking.quantity} ticket(s)`,
                    images: booking.image ? [booking.image] : [],
                  },
                  unit_amount: Math.round(booking.totalPrice * 100), // Convert to cents
                },
                quantity: 1,
              },
            ],
            mode: 'payment',
            // IMPORTANT: Use full URL with correct frontend URL
            success_url: `${
              process.env.FRONTEND_URL || 'http://localhost:5173'
            }/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}&booking_id=${bookingId}`,
            cancel_url: `${
              process.env.FRONTEND_URL || 'http://localhost:5173'
            }/payment-cancel?booking_id=${bookingId}`,
            customer_email: userEmail,
            metadata: {
              bookingId: bookingId,
              userEmail: userEmail,
              amount: booking.totalPrice.toString(),
              vendorEmail: booking.vendorEmail,
              directPayment: 'true',
            },
          });

          console.log('✅ Stripe session created:', session.id);
          console.log('Success URL:', session.success_url);
          console.log('Checkout URL:', session.url);

          // Save session ID to booking
          await bookingsCollection.updateOne(
            { _id: new ObjectId(bookingId) },
            {
              $set: {
                stripeSessionId: session.id,
                updatedAt: new Date(),
              },
            }
          );

          res.json({
            success: true,
            sessionId: session.id,
            url: session.url, // This is the URL user should redirect to
            successUrl: session.success_url,
            bookingId: bookingId,
            debug: {
              frontendUrl: process.env.FRONTEND_URL,
              amount: booking.totalPrice,
            },
          });
        } catch (stripeError) {
          console.error('❌ Stripe API Error:', stripeError);

          // Fallback to mock payment if Stripe fails
          const mockTransactionId = `fallback_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;

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
            }
          );

          await transactionsCollection.insertOne({
            transactionId: mockTransactionId,
            bookingId: bookingId,
            userEmail: userEmail,
            userName: booking.userName,
            ticketTitle: booking.ticketTitle,
            amount: booking.totalPrice,
            quantity: booking.quantity,
            status: 'completed',
            paymentMethod: 'fallback_card',
            paymentDate: new Date(),
            createdAt: new Date(),
            isMock: true,
          });

          res.json({
            success: true,
            message: 'Fallback payment successful (Stripe failed)',
            transactionId: mockTransactionId,
            redirectUrl: `${
              process.env.FRONTEND_URL || 'http://localhost:5173'
            }/dashboard/payment-success?booking_id=${bookingId}&mock=true`,
            isMock: true,
          });
        }
      } catch (error) {
        console.error('❌ Direct payment error:', error);
        res.status(500).json({
          success: false,
          message: error.message || 'Failed to create payment session',
          error:
            process.env.NODE_ENV === 'development' ? error.stack : undefined,
        });
      }
    });
    app.post(
      '/api/payments/direct-payment',

      async (req, res) => {
        try {
          const { bookingId } = req.body;

          if (!bookingId) {
            return res.status(400).json({
              success: false,
              message: 'Booking ID is required',
            });
          }

          // Find booking
          const booking = await bookingsCollection.findOne({
            _id: new ObjectId(bookingId),
            userEmail: req.token_email,
          });

          if (!booking) {
            return res.status(404).json({
              success: false,
              message: 'Booking not found',
            });
          }

          if (booking.paymentStatus === 'paid') {
            return res.status(400).json({
              success: false,
              message: 'Booking already paid',
            });
          }

          // Check if ticket is available
          const ticket = await ticketsCollection.findOne({
            _id: new ObjectId(booking.ticketId),
          });

          if (!ticket || ticket.ticketQuantity < booking.quantity) {
            return res.status(400).json({
              success: false,
              message: 'Ticket not available',
            });
          }

          // Directly accept the booking (no vendor approval needed)
          if (booking.status === 'pending') {
            await bookingsCollection.updateOne(
              { _id: new ObjectId(bookingId) },
              {
                $set: {
                  status: 'accepted',
                  updatedAt: new Date(),
                },
              }
            );
          }

          // If Stripe is not configured, use mock payment
          if (!stripe) {
            const mockTransactionId = `mock_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`;

            // Update booking to paid
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
              }
            );

            // Create transaction record
            await transactionsCollection.insertOne({
              transactionId: mockTransactionId,
              bookingId: bookingId,
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

            return res.json({
              success: true,
              message: 'Mock payment successful!',
              transactionId: mockTransactionId,
              redirectUrl: `${
                process.env.FRONTEND_URL || 'http://localhost:5173'
              }/payment-success?booking_id=${bookingId}`,
              isMock: true,
            });
          }

          // Create Stripe checkout session
          const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
              {
                price_data: {
                  currency: 'bdt',
                  product_data: {
                    name: booking.ticketTitle,
                    description: `${booking.from} to ${booking.to} - ${booking.quantity} ticket(s)`,
                    images: booking.image ? [booking.image] : [],
                  },
                  unit_amount: Math.round(booking.totalPrice * 100),
                },
                quantity: 1,
              },
            ],
            mode: 'payment',
            success_url: `${
              process.env.FRONTEND_URL || 'http://localhost:5173'
            }/payment-success?session_id={CHECKOUT_SESSION_ID}&booking_id=${bookingId}`,
            cancel_url: `${
              process.env.FRONTEND_URL || 'http://localhost:5173'
            }/payment-cancel?booking_id=${bookingId}`,
            customer_email: req.token_email,
            metadata: {
              bookingId: bookingId,
              userEmail: req.token_email,
              amount: booking.totalPrice,
              vendorEmail: booking.vendorEmail,
              directPayment: 'true',
            },
          });

          // Save session ID to booking
          await bookingsCollection.updateOne(
            { _id: new ObjectId(bookingId) },
            {
              $set: {
                stripeSessionId: session.id,
                updatedAt: new Date(),
              },
            }
          );

          res.json({
            success: true,
            sessionId: session.id,
            url: session.url,
          });
        } catch (error) {
          console.error('Direct payment error:', error);
          res.status(500).json({
            success: false,
            message: error.message || 'Failed to create payment session',
          });
        }
      }
    );

    // Webhook handler update (server.js তে)
    app.post('/api/webhook', async (req, res) => {
      let event;
      const sig = req.headers['stripe-signature'];

      try {
        if (!process.env.STRIPE_WEBHOOK_SECRET) {
          console.log('⚠️ Stripe webhook secret not configured');
          return res
            .status(400)
            .json({ error: 'Webhook secret not configured' });
        }

        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res
          .status(400)
          .json({ error: 'Webhook signature verification failed' });
      }

      // Handle the event
      switch (event.type) {
        case 'checkout.session.completed':
          const session = event.data.object;

          try {
            const bookingId = session.metadata.bookingId;
            const userEmail = session.metadata.userEmail;
            const amount = session.metadata.amount;
            const isDirectPayment = session.metadata.directPayment === 'true';

            // Find the booking
            const booking = await bookingsCollection.findOne({
              _id: new ObjectId(bookingId),
              stripeSessionId: session.id,
            });

            if (!booking) {
              console.error('Booking not found for session:', session.id);
              break;
            }

            // Update booking status
            await bookingsCollection.updateOne(
              { _id: new ObjectId(bookingId) },
              {
                $set: {
                  status: 'paid',
                  paymentStatus: 'paid',
                  paymentDate: new Date(),
                  stripePaymentIntentId: session.payment_intent,
                  transactionId: session.id,
                  updatedAt: new Date(),
                },
              }
            );

            // Create transaction record
            await transactionsCollection.insertOne({
              transactionId: session.id,
              stripePaymentIntentId: session.payment_intent,
              bookingId: bookingId,
              userEmail: userEmail,
              userName: booking.userName,
              ticketTitle: booking.ticketTitle,
              amount: parseFloat(amount),
              quantity: booking.quantity,
              status: 'completed',
              paymentMethod: 'card',
              paymentDate: new Date(),
              createdAt: new Date(),
              stripeMetadata: {
                sessionId: session.id,
                customerEmail: session.customer_email,
                paymentStatus: session.payment_status,
                isDirectPayment: isDirectPayment,
              },
            });

            console.log(
              `✅ Payment successful for booking: ${bookingId} (Direct: ${isDirectPayment})`
            );
          } catch (error) {
            console.error('Error processing webhook:', error);
          }
          break;

        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    });
    app.post('/api/create-checkout-session', async (req, res) => {
      try {
        const { bookingId, userEmail } = req.body;

        if (!bookingId || !userEmail) {
          return res.status(400).json({
            success: false,
            message: 'Booking ID and user email are required',
          });
        }

        // Find booking
        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(bookingId),
          userEmail: userEmail,
        });

        if (!booking) {
          return res.status(404).json({
            success: false,
            message: 'Booking not found',
          });
        }

        if (booking.paymentStatus === 'paid') {
          return res.status(400).json({
            success: false,
            message: 'Booking already paid',
          });
        }

        // Create Stripe session
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [
            {
              price_data: {
                currency: 'bdt',
                product_data: {
                  name: booking.ticketTitle,
                  description: `${booking.from} to ${booking.to} - ${booking.quantity} ticket(s)`,
                },
                unit_amount: Math.round(booking.totalPrice * 100),
              },
              quantity: 1,
            },
          ],
          mode: 'payment',
          success_url: `${
            process.env.FRONTEND_URL || 'http://localhost:5173'
          }/payment-success?session_id={CHECKOUT_SESSION_ID}&booking_id=${bookingId}`,
          cancel_url: `${
            process.env.FRONTEND_URL || 'http://localhost:5173'
          }/payment-cancel?booking_id=${bookingId}`,
          customer_email: userEmail,
          metadata: {
            bookingId: bookingId,
            userEmail: userEmail,
            amount: booking.totalPrice,
          },
        });

        res.json({
          success: true,
          sessionId: session.id,
          url: session.url,
        });
      } catch (error) {
        console.error('Create checkout session error:', error);
        res.status(500).json({
          success: false,
          message: 'Payment failed to initialize',
        });
      }
    });

    // Verify payment
    app.get('/api/verify-payment/:bookingId', async (req, res) => {
      try {
        const { bookingId } = req.params;
        const { userEmail } = req.query;

        if (!userEmail) {
          return res.status(400).json({
            success: false,
            message: 'User email is required',
          });
        }

        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(bookingId),
          userEmail: userEmail,
        });

        if (!booking) {
          return res.status(404).json({
            success: false,
            message: 'Booking not found',
          });
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
        console.error('Verify payment error:', error);
        res.status(500).json({
          success: false,
          message: 'Verification failed',
        });
      }
    });

    // Get Transactions (WITH TOKEN)
    app.get(
      '/api/transactions/my-transactions',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          console.log('📜 Fetching transactions for:', req.token_email);

          const transactions = await transactionsCollection
            .find({ userEmail: req.token_email })
            .sort({ createdAt: -1 })
            .toArray();

          console.log('✅ Transactions found:', transactions.length);

          if (transactions.length === 0) {
            const paidBookings = await bookingsCollection
              .find({
                userEmail: req.token_email,
                paymentStatus: 'paid',
              })
              .sort({ paymentDate: -1 })
              .toArray();

            const convertedTransactions = paidBookings.map(booking => ({
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

            res.json({
              success: true,
              transactions: convertedTransactions,
              count: convertedTransactions.length,
            });
          } else {
            res.json({
              success: true,
              transactions: transactions,
              count: transactions.length,
            });
          }
        } catch (error) {
          console.error('❌ Get transactions error:', error);
          res.status(500).json({
            success: false,
            message: 'Failed to load transactions',
          });
        }
      }
    );

    // Verify Payment (For compatibility)
    app.get(
      '/api/verify-payment/:bookingId',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          const { bookingId } = req.params;

          const booking = await bookingsCollection.findOne({
            _id: new ObjectId(bookingId),
            userEmail: req.token_email,
          });

          if (!booking) {
            return res.status(404).json({
              success: false,
              message: 'Booking not found',
            });
          }

          res.json({
            success: true,
            paid: booking.paymentStatus === 'paid',
            booking: {
              id: booking._id,
              status: booking.status,
              paymentStatus: booking.paymentStatus,
              amount: booking.totalPrice,
            },
          });
        } catch (error) {
          console.error('Verify payment error:', error);
          res.status(500).json({
            success: false,
            message: 'Verification failed',
          });
        }
      }
    );

    // ==========================================
    // Vendor Routes
    // ==========================================
    app.get(
      '/api/bookings/vendor-requests',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          const vendor = await usersCollection.findOne({
            email: req.token_email,
          });

          if (!vendor || vendor.role !== 'vendor') {
            return res.status(403).json({
              success: false,
              message: 'Vendor access required',
            });
          }

          const bookings = await bookingsCollection
            .find({ vendorEmail: req.token_email })
            .sort({ createdAt: -1 })
            .toArray();

          res.json({ success: true, bookings });
        } catch (error) {
          console.error('Get vendor bookings error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );

    // Accept booking (Vendor)
    app.patch(
      '/api/bookings/:id/accept',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid booking ID',
            });
          }

          const booking = await bookingsCollection.findOne({
            _id: new ObjectId(req.params.id),
          });

          if (!booking) {
            return res.status(404).json({
              success: false,
              message: 'Booking not found',
            });
          }

          if (booking.vendorEmail !== req.token_email) {
            return res.status(403).json({
              success: false,
              message: 'Not authorized',
            });
          }

          await bookingsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'accepted', updatedAt: new Date() } }
          );

          res.json({
            success: true,
            message: 'Booking accepted successfully',
          });
        } catch (error) {
          console.error('Accept booking error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );

    // Reject booking (Vendor)
    app.patch(
      '/api/bookings/:id/reject',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid booking ID',
            });
          }

          const booking = await bookingsCollection.findOne({
            _id: new ObjectId(req.params.id),
          });

          if (!booking) {
            return res.status(404).json({
              success: false,
              message: 'Booking not found',
            });
          }

          if (booking.vendorEmail !== req.token_email) {
            return res.status(403).json({
              success: false,
              message: 'Not authorized',
            });
          }

          await bookingsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'rejected', updatedAt: new Date() } }
          );

          if (booking.ticketId && ObjectId.isValid(booking.ticketId)) {
            await ticketsCollection.updateOne(
              { _id: new ObjectId(booking.ticketId) },
              {
                $inc: { ticketQuantity: booking.quantity },
                $set: { updatedAt: new Date() },
              }
            );
          }

          res.json({
            success: true,
            message: 'Booking rejected',
          });
        } catch (error) {
          console.error('Reject booking error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );

    // ==========================================
    // ADMIN STATS
    // ==========================================
    app.get('/api/admin/stats', verifyFireBaseToken, async (req, res) => {
      try {
        const adminUser = await usersCollection.findOne({
          email: req.token_email,
        });

        if (!adminUser || adminUser.role !== 'admin') {
          return res.status(403).json({
            success: false,
            message: 'Admin access required',
          });
        }

        const totalUsers = await usersCollection.countDocuments();
        const totalVendors = await usersCollection.countDocuments({
          role: 'vendor',
        });
        const totalTickets = await ticketsCollection.countDocuments();
        const pendingTickets = await ticketsCollection.countDocuments({
          verificationStatus: 'pending',
        });
        const totalBookings = await bookingsCollection.countDocuments();
        const totalRevenue = await transactionsCollection
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
            totalRevenue: totalRevenue[0]?.total || 0,
          },
        });
      } catch (error) {
        console.error('Get admin stats error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // ==========================================
    // VENDOR STATS
    // ==========================================
    app.get('/api/vendor/stats', verifyFireBaseToken, async (req, res) => {
      try {
        const vendor = await usersCollection.findOne({
          email: req.token_email,
        });

        if (!vendor || vendor.role !== 'vendor') {
          return res.status(403).json({
            success: false,
            message: 'Vendor access required',
          });
        }

        const paidBookings = await bookingsCollection
          .find({ vendorEmail: req.token_email, status: 'paid' })
          .toArray();

        const totalRevenue = paidBookings.reduce(
          (sum, b) => sum + (b.totalPrice || 0),
          0
        );
        const totalTicketsSold = paidBookings.reduce(
          (sum, b) => sum + (b.quantity || 0),
          0
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
        console.error('Vendor stats error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // ==========================================
    // VENDOR REQUESTS ROUTES
    // ==========================================
    // VENDOR PROFILE ROUTES - FIXED
    // ==========================================

    // 1. Get Vendor Profile
    app.get('/api/vendors/profile', verifyFireBaseToken, async (req, res) => {
      try {
        console.log('📋 Fetching vendor profile for:', req.token_email);

        // Check if user is vendor
        const user = await usersCollection.findOne({
          email: req.token_email,
        });

        if (!user) {
          return res.status(404).json({
            success: false,
            message: 'User not found',
          });
        }

        // Get vendor profile
        const vendorProfile = await vendorProfilesCollection.findOne({
          email: req.token_email,
        });

        if (!vendorProfile) {
          // Create default vendor profile if doesn't exist
          const defaultProfile = {
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

          // Insert default profile
          await vendorProfilesCollection.insertOne(defaultProfile);

          return res.json({
            success: true,
            vendor: defaultProfile,
            isNew: true,
          });
        }

        res.json({
          success: true,
          vendor: vendorProfile,
        });
      } catch (error) {
        console.error('❌ Get vendor profile error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message,
        });
      }
    });

    // 2. Update Vendor Profile - FIXED VERSION
    app.put('/api/vendors/profile', verifyFireBaseToken, async (req, res) => {
      try {
        const {
          companyName,
          contactPerson,
          email,
          phone,
          address,
          businessType,
          taxId,
          website,
          description,
        } = req.body;

        console.log('📝 Updating vendor profile for:', req.token_email);
        console.log('Request data:', req.body);

        // Validate required fields
        if (!companyName || !contactPerson || !phone || !address) {
          return res.status(400).json({
            success: false,
            message:
              'Please fill all required fields (Company Name, Contact Person, Phone, Address)',
          });
        }

        // Check if user exists
        const user = await usersCollection.findOne({
          email: req.token_email,
        });

        if (!user) {
          return res.status(404).json({
            success: false,
            message: 'User not found',
          });
        }

        // Update user name if contact person is different
        if (contactPerson !== user.name) {
          await usersCollection.updateOne(
            { email: req.token_email },
            {
              $set: {
                name: contactPerson,
                updatedAt: new Date(),
              },
            }
          );
          console.log('✅ Updated user name to:', contactPerson);
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

        // Check if vendor profile exists
        const existingProfile = await vendorProfilesCollection.findOne({
          email: req.token_email,
        });

        let result;
        let message;

        if (existingProfile) {
          // Update existing profile
          result = await vendorProfilesCollection.updateOne(
            { email: req.token_email },
            { $set: vendorData }
          );
          message = 'Vendor profile updated successfully';
          console.log('✅ Vendor profile updated');
        } else {
          // Create new profile
          vendorData.createdAt = new Date();
          result = await vendorProfilesCollection.insertOne(vendorData);
          message = 'Vendor profile created successfully';
          console.log('✅ New vendor profile created');
        }

        res.json({
          success: true,
          message: message,
          vendor: vendorData,
        });
      } catch (error) {
        console.error('❌ Update vendor profile error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message,
        });
      }
    });

    // 3. Alternative: POST route for creating/updating vendor profile
    app.post('/api/vendors/profile', verifyFireBaseToken, async (req, res) => {
      try {
        const {
          companyName,
          contactPerson,
          email,
          phone,
          address,
          businessType,
          taxId,
          website,
          description,
        } = req.body;

        console.log(
          '📝 Creating/Updating vendor profile for:',
          req.token_email
        );

        // Validate required fields
        if (!companyName || !contactPerson || !phone || !address) {
          return res.status(400).json({
            success: false,
            message: 'Please fill all required fields',
          });
        }

        const user = await usersCollection.findOne({
          email: req.token_email,
        });

        if (!user) {
          return res.status(404).json({
            success: false,
            message: 'User not found',
          });
        }

        // Update user role to vendor if not already
        if (user.role !== 'vendor') {
          await usersCollection.updateOne(
            { email: req.token_email },
            {
              $set: {
                role: 'vendor',
                updatedAt: new Date(),
              },
            }
          );
          console.log('✅ Updated user role to vendor');
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

        // Use upsert to create or update
        const result = await vendorProfilesCollection.updateOne(
          { email: req.token_email },
          { $set: vendorData },
          { upsert: true }
        );

        if (result.upsertedCount > 0) {
          vendorData.createdAt = new Date();
        }

        res.json({
          success: true,
          message:
            result.upsertedCount > 0
              ? 'Profile created successfully'
              : 'Profile updated successfully',
          vendor: vendorData,
        });
      } catch (error) {
        console.error('❌ POST vendor profile error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // 4. Get Vendor Stats - FIXED
    app.get('/api/vendors/stats', verifyFireBaseToken, async (req, res) => {
      try {
        console.log('📊 Fetching vendor stats for:', req.token_email);

        const user = await usersCollection.findOne({
          email: req.token_email,
        });

        if (!user) {
          return res.status(404).json({
            success: false,
            message: 'User not found',
          });
        }

        const vendorEmail = req.token_email;

        // Get total tickets added by vendor
        const totalTickets = await ticketsCollection.countDocuments({
          vendorEmail: vendorEmail,
        });

        // Get all bookings for this vendor
        const vendorBookings = await bookingsCollection
          .find({
            vendorEmail: vendorEmail,
          })
          .toArray();

        const totalBookings = vendorBookings.length;

        // Calculate total revenue from paid bookings
        const paidBookings = vendorBookings.filter(
          b => b.paymentStatus === 'paid' || b.status === 'paid'
        );

        const totalRevenue = paidBookings.reduce((sum, booking) => {
          return sum + (booking.totalPrice || 0);
        }, 0);

        // Get pending ticket requests
        const pendingTickets = await bookingsCollection.countDocuments({
          vendorEmail: vendorEmail,
          status: 'pending',
        });

        const stats = {
          totalTickets,
          totalBookings,
          totalRevenue,
          pendingTickets,
        };

        console.log('✅ Vendor stats calculated:', stats);

        res.json({
          success: true,
          stats,
        });
      } catch (error) {
        console.error('❌ Get vendor stats error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message,
        });
      }
    });

    // 5. Debug route to check vendor profile
    app.get('/api/vendors/debug', verifyFireBaseToken, async (req, res) => {
      try {
        console.log('🔍 Debug vendor profile for:', req.token_email);

        const user = await usersCollection.findOne({
          email: req.token_email,
        });

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
            vendorProfile: vendorProfile,
            ticketsCount,
            bookingsCount,
          },
        });
      } catch (error) {
        console.error('Debug vendor error:', error);
        res.status(500).json({
          success: false,
          message: error.message,
        });
      }
    });

    // ==========================================
    // INITIALIZE VENDOR PROFILES COLLECTION
    // ==========================================

    // Check and create vendorProfiles collection if not exists
    const initializeCollections = async () => {
      try {
        const collections = await database.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);

        if (!collectionNames.includes('vendorProfiles')) {
          await database.createCollection('vendorProfiles');
          console.log('✅ Created vendorProfiles collection');
        }

        if (!collectionNames.includes('userProfiles')) {
          await database.createCollection('userProfiles');
          console.log('✅ Created userProfiles collection');
        }

        if (!collectionNames.includes('adminProfiles')) {
          await database.createCollection('adminProfiles');
          console.log('✅ Created adminProfiles collection');
        }

        // Create indexes
        await vendorProfilesCollection.createIndex(
          { email: 1 },
          { unique: true }
        );
        await userProfilesCollection.createIndex(
          { email: 1 },
          { unique: true }
        );
        await adminProfilesCollection.createIndex(
          { email: 1 },
          { unique: true }
        );

        console.log('✅ All profile collections initialized');
      } catch (error) {
        console.error('❌ Initialize collections error:', error);
      }
    };

    // Call initialization
    initializeCollections();
    // ==========================================

    // Apply to become vendor
    app.post('/api/vendor-requests', verifyFireBaseToken, async (req, res) => {
      try {
        const { name, email, phone, address, experience, reason } = req.body;

        if (!name || !email || !phone || !address) {
          return res.status(400).json({
            success: false,
            message: 'Please fill all required fields',
          });
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
          return res.status(400).json({
            success: false,
            message: 'You are already a vendor',
          });
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
        console.error('Vendor request error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Get vendor requests (Admin only)
    app.get('/api/vendor-requests', verifyFireBaseToken, async (req, res) => {
      try {
        const adminUser = await usersCollection.findOne({
          email: req.token_email,
        });

        if (!adminUser || adminUser.role !== 'admin') {
          return res.status(403).json({
            success: false,
            message: 'Admin access required',
          });
        }

        const requests = await vendorRequestsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();

        res.json({ success: true, requests });
      } catch (error) {
        console.error('Get vendor requests error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    });

    // Approve vendor request (Admin only)
    app.patch(
      '/api/vendor-requests/:id/approve',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          const adminUser = await usersCollection.findOne({
            email: req.token_email,
          });

          if (!adminUser || adminUser.role !== 'admin') {
            return res.status(403).json({
              success: false,
              message: 'Admin access required',
            });
          }

          if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid request ID',
            });
          }

          const request = await vendorRequestsCollection.findOne({
            _id: new ObjectId(req.params.id),
          });

          if (!request) {
            return res.status(404).json({
              success: false,
              message: 'Request not found',
            });
          }

          await vendorRequestsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'approved', updatedAt: new Date() } }
          );

          await usersCollection.updateOne(
            { email: request.userEmail },
            { $set: { role: 'vendor', updatedAt: new Date() } }
          );

          res.json({
            success: true,
            message: 'Vendor request approved and user role updated',
          });
        } catch (error) {
          console.error('Approve vendor request error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );

    // Reject vendor request (Admin only)
    app.patch(
      '/api/vendor-requests/:id/reject',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          const adminUser = await usersCollection.findOne({
            email: req.token_email,
          });

          if (!adminUser || adminUser.role !== 'admin') {
            return res.status(403).json({
              success: false,
              message: 'Admin access required',
            });
          }

          if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid request ID',
            });
          }

          const request = await vendorRequestsCollection.findOne({
            _id: new ObjectId(req.params.id),
          });

          if (!request) {
            return res.status(404).json({
              success: false,
              message: 'Request not found',
            });
          }

          await vendorRequestsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'rejected', updatedAt: new Date() } }
          );

          res.json({
            success: true,
            message: 'Vendor request rejected',
          });
        } catch (error) {
          console.error('Reject vendor request error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );

    // ==========================================
    // 404 Handler
    // ==========================================
    app.use((req, res) => {
      res.status(404).json({
        success: false,
        message: 'Route not found',
      });
    });

    // ==========================================
    // Global Error Handler
    // ==========================================
    // server.js - Add these debugging routes after other routes

    // ==========================================
    // DEBUG AND TEST ROUTES
    // ==========================================

    // Get booking details with debug info
    app.get('/api/debug/booking/:id', async (req, res) => {
      try {
        const bookingId = req.params.id;

        if (!ObjectId.isValid(bookingId)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid booking ID',
          });
        }

        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(bookingId),
        });

        if (!booking) {
          return res.status(404).json({
            success: false,
            message: 'Booking not found',
          });
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
        console.error('Debug booking error:', error);
        res.status(500).json({
          success: false,
          message: error.message,
        });
      }
    });

    // Accept booking for testing (without vendor approval)
    app.post('/api/test/booking/:id/accept', async (req, res) => {
      try {
        const bookingId = req.params.id;

        if (!ObjectId.isValid(bookingId)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid booking ID',
          });
        }

        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(bookingId),
        });

        if (!booking) {
          return res.status(404).json({
            success: false,
            message: 'Booking not found',
          });
        }

        // Update booking to accepted status
        await bookingsCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          {
            $set: {
              status: 'accepted',
              updatedAt: new Date(),
            },
          }
        );

        res.json({
          success: true,
          message: 'Booking accepted for testing',
          bookingId: bookingId,
          newStatus: 'accepted',
        });
      } catch (error) {
        console.error('Accept booking error:', error);
        res.status(500).json({
          success: false,
          message: error.message,
        });
      }
    });

    // Create test booking
    app.post(
      '/api/test/create-booking',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          const { ticketId, quantity } = req.body;

          // Find a ticket
          const ticket = await ticketsCollection.findOne({
            verificationStatus: 'approved',
            ticketQuantity: { $gte: quantity || 1 },
          });

          if (!ticket) {
            return res.status(404).json({
              success: false,
              message: 'No available tickets found',
            });
          }

          const user = await usersCollection.findOne({
            email: req.token_email,
          });

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
            status: 'accepted', // Directly accepted for testing
            paymentStatus: 'unpaid',
            stripeSessionId: null,
            stripePaymentIntentId: null,
            paymentDate: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const result = await bookingsCollection.insertOne(newBooking);

          // Reduce ticket quantity
          await ticketsCollection.updateOne(
            { _id: ticket._id },
            {
              $inc: { ticketQuantity: -(quantity || 1) },
              $set: { updatedAt: new Date() },
            }
          );

          res.status(201).json({
            success: true,
            message: 'Test booking created successfully',
            bookingId: result.insertedId,
            booking: {
              id: result.insertedId,
              status: 'accepted',
              paymentStatus: 'unpaid',
              totalPrice: newBooking.totalPrice,
            },
          });
        } catch (error) {
          console.error('Create test booking error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );
    // server.js - Add this test route

    // Create test booking with accepted status
    app.post(
      '/api/test/create-accepted-booking',
      verifyFireBaseToken,
      async (req, res) => {
        try {
          const { ticketId, quantity } = req.body;

          // Find a ticket
          const ticket = await ticketsCollection.findOne({
            verificationStatus: 'approved',
            ticketQuantity: { $gte: quantity || 1 },
          });

          if (!ticket) {
            return res.status(404).json({
              success: false,
              message: 'No available tickets found',
            });
          }

          const user = await usersCollection.findOne({
            email: req.token_email,
          });

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
            status: 'accepted', // Directly accepted
            paymentStatus: 'unpaid', // Unpaid - ready for payment
            stripeSessionId: null,
            stripePaymentIntentId: null,
            paymentDate: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const result = await bookingsCollection.insertOne(newBooking);

          // Reduce ticket quantity
          await ticketsCollection.updateOne(
            { _id: ticket._id },
            {
              $inc: { ticketQuantity: -(quantity || 1) },
              $set: { updatedAt: new Date() },
            }
          );

          console.log(
            `✅ Test booking created with accepted status: ${result.insertedId}`
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
          console.error('Create test booking error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error',
          });
        }
      }
    );
    app.use((error, req, res, next) => {
      console.error('Global error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    });

    console.log('✅ All routes registered successfully!');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
  }
}

run().catch(console.dir);

// Start Server
app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
  console.log(`📍 API Base URL: http://localhost:${port}`);
  console.log(`📊 Total API Endpoints: 50+`);
});
