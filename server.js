const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');
const admin = require('firebase-admin');
const multer = require('multer');
const vision = require('@google-cloud/vision');
const fs = require('fs');
const path = require('path');
const serviceAccount = require('./firebase-service-account.json');
const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');
const firebaseConfig = require('./firebaseConfig');
const firebaseApp = initializeApp(firebaseConfig);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const app = express();
const PORT = 3000;
const SECRET_KEY = 'your_secret_key';

// Google Vision Client
const client = new vision.ImageAnnotatorClient();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Ensure uploads folder exists
const UPLOAD_DIR = './uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

// Multer configuration for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR); // Save images in the uploads directory
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Unique filename
  },
});
const upload = multer({ storage });

// Handle property registration (with the new fields)
app.post('/hostel-registration', upload.fields([
  { name: 'images', maxCount: 10 }, // Max 10 images
  { name: 'video', maxCount: 1 }, // Video upload
  { name: 'threeDVideo', maxCount: 1 }, // Optional 3D video
  { name: '3DView', maxCount: 1 } // Optional 3D view
]), async (req, res) => {
  const { propertyType, location, rent, advanceAmount, ownerName, contactNumber, description, latitude, longitude } = req.body;

  if (!propertyType || !location || !rent || !advanceAmount || !ownerName || !contactNumber || !description || !latitude || !longitude) {
    return res.status(400).json({ message: 'All fields are required.' });
  }

  try {
    // Ensure required files are uploaded
    if (!req.files || !req.files['images']) {
      return res.status(400).json({ message: 'At least one image is required.' });
    }

    const imagesPath = req.files['images'].map(file => file.path); // Collect all image paths
    const videoPath = req.files['video'] ? req.files['video'][0].path : null;
    const threeDVideoPath = req.files['threeDVideo'] ? req.files['threeDVideo'][0].path : null;
    const threeDViewPath = req.files['3DView'] ? req.files['3DView'][0].path : null;

    // Google Vision API call for image analysis (optional)
    const imageLabels = [];
    for (const imagePath of imagesPath) {
      const [result] = await client.labelDetection(imagePath);
      const labels = result.labelAnnotations;
      labels.forEach(label => imageLabels.push(label.description));
    }

    // Save hostel registration data to Firestore
    const hostelRef = db.collection('hostels').doc(contactNumber); // Assuming contact number as unique identifier
    await hostelRef.set({
      propertyType,
      location,
      rent,
      advanceAmount,
      ownerName,
      contactNumber,
      description,
      latitude,
      longitude,
      imagesPath,
      videoPath,
      threeDVideoPath,
      threeDViewPath,
      imageLabels,
      verified: true, // Can be updated based on future verification
    });

    res.status(201).json({ message: 'Hostel registration successful.' });
  } catch (err) {
    console.error('Error during hostel registration:', err);
    res.status(500).json({ message: 'Error during hostel registration.' });
  }
});

// Handle owner verification (no changes needed)
app.post('/owner-verification', upload.fields([
  { name: 'aadharProof', maxCount: 1 },
  { name: 'ownerSelfie', maxCount: 1 }
]), async (req, res) => {
  const { ownerName, contactNumber, address, aadharNumber } = req.body;

  if (!ownerName || !contactNumber || !address || !aadharNumber) {
    return res.status(400).json({ message: 'All fields are required.' });
  }

  try {
    // Ensure files are uploaded
    if (!req.files || !req.files['aadharProof'] || !req.files['ownerSelfie']) {
      return res.status(400).json({ message: 'Both Aadhar proof and selfie are required.' });
    }

    const aadharProofPath = req.files['aadharProof'][0].path;
    const ownerSelfiePath = req.files['ownerSelfie'][0].path;

    // Google Vision API call for text detection on Aadhar proof
    const [result] = await client.textDetection(aadharProofPath);
    const detectedText = result.textAnnotations[0]?.description || '';

    if (!detectedText.includes(aadharNumber)) {
      return res.status(400).json({ message: 'Aadhar number does not match the document.' });
    }

    // Save owner verification data to Firestore
    const ownerRef = db.collection('owner_verification').doc(contactNumber);
    await ownerRef.set({
      ownerName,
      contactNumber,
      address,
      aadharNumber,
      aadharProofPath,
      ownerSelfiePath,
      verified: true,
    });

    res.status(201).json({ message: 'Owner verification successful.' });
  } catch (err) {
    console.error('Error during verification:', err);
    res.status(500).json({ message: 'Error during owner verification.' });
  }
});

// Handle login (no changes needed)
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    const userRef = db.collection('users').doc(username);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(400).json({ message: 'Invalid username or password.' });
    }

    const user = doc.data();
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid username or password.' });
    }

    const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: '1h' });
    res.status(200).json({ token, message: 'Login successful.' });
  } catch (err) {
    res.status(500).json({ message: 'Error logging in.' });
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.session?.destroy((err) => {
    if (err) {
      return res.redirect('/dashboard');
    }

    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
