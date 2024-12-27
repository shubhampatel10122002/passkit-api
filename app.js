const express = require('express');
const PKPass = require('passkit-generator').PKPass;
const path = require('path');
const fs = require('fs').promises;

const app = express();
app.use(express.json());

// Serve static files from temp directory
app.use('/passes', express.static('temp'));

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Main endpoint to generate pass
app.post('/generate-pass', async (req, res) => {
  try {
    const { expiryDate, serviceType, discount, uses = 1 } = req.body;

    // Validate required fields
    if (!expiryDate || !serviceType || !discount) {
      return res.status(400).json({ 
        error: 'Missing required fields. Please provide expiryDate, serviceType, and discount.' 
      });
    }

    // Validate expiry date is in future
    const expiryDateObj = new Date(expiryDate);
    if (expiryDateObj < new Date()) {
      return res.status(400).json({ 
        error: 'Expiry date must be in the future' 
      });
    }

    // Initialize pass
    const pass = new PKPass({
      model: path.join(__dirname, 'models/pass.json'),
      certificates: {
        wwdr: path.join(__dirname, 'certs/wwdr.pem'),
        signerCert: path.join(__dirname, 'certs/p12certforchallenge.p12'),
        signerKey: {
          keyFile: path.join(__dirname, 'certs/p12certforchallenge.p12'),
          passphrase: 'letm3in&&^*'
        }
      }
    });

    const uniqueId = Date.now().toString();
    
    // Set barcode
    pass.setBarcodes({
      message: uniqueId,
      format: 'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1'
    });

    // Set pass fields
    pass.primaryFields.push({
      key: "offer",
      label: "DISCOUNT",
      value: `${discount}% OFF`
    });

    pass.secondaryFields.push({
      key: "service",
      label: "SERVICE",
      value: serviceType
    });

    pass.secondaryFields.push({
      key: "expires",
      label: "EXPIRES",
      value: expiryDateObj.toLocaleDateString()
    });

    pass.auxiliaryFields.push({
      key: "uses",
      label: "USES REMAINING",
      value: uses.toString()
    });

    // Set expiry notification
    pass.setExpirationDate(expiryDateObj.toISOString());
    
    // Generate pass
    const buffer = await pass.generate();

    // Ensure temp directory exists
    await fs.mkdir('temp', { recursive: true });
    
    // Save pass file
    const filePath = path.join('temp', `${uniqueId}.pkpass`);
    await fs.writeFile(filePath, buffer);

    // Clean up old files (keep last 100)
    const files = await fs.readdir('temp');
    if (files.length > 100) {
      const oldestFiles = files
        .map(file => ({ file, time: fs.stat(path.join('temp', file)).mtime }))
        .sort((a, b) => a.time - b.time)
        .slice(0, files.length - 100);
      
      await Promise.all(oldestFiles.map(({ file }) => 
        fs.unlink(path.join('temp', file))
      ));
    }

    // Generate pass URL
    const passUrl = `${req.protocol}://${req.get('host')}/passes/${uniqueId}.pkpass`;

    res.json({
      success: true,
      passUrl,
      passId: uniqueId,
      expiryDate: expiryDateObj.toISOString(),
      serviceType,
      discount,
      uses
    });

  } catch (error) {
    console.error('Error generating pass:', error);
    res.status(500).json({ 
      error: 'Failed to generate pass',
      details: error.message 
    });
  }
});

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // In a production environment, you might want to notify your error tracking service here
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access passes at: http://localhost:${PORT}/passes/{passId}.pkpass`);
});
