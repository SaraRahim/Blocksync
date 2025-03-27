// server.js - BlockSync Signaling Server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Create Express app
const app = express();
app.use(cors());

// Create HTTP server
const server = http.createServer(app);

// Create Socket.IO server
const io = new Server(server, {
  cors: {
    origin: "*", // Allow connections from any origin
    methods: ["GET", "POST"]
  }
});

const announceTimestamps = new Map(); // Rate limiter for announce events

// Store connected users and their devices
const connectedUsers = new Map();

app.get('/', (req, res) => {
  res.send('BlockSync Signaling Server Running');
});

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);
  
  // Extract user info from query parameters
  const userId = socket.handshake.query.userId;
  const deviceId = socket.handshake.query.deviceId || socket.id;
  
  if (!userId) {
    console.log(`Connection rejected: Missing userId`);
    socket.disconnect();
    return;
  }
  
  // Track this user and device
  if (!connectedUsers.has(userId)) {
    connectedUsers.set(userId, new Map());
  }
  
  // Store the user's device info
  const userDevices = connectedUsers.get(userId);
  userDevices.set(deviceId, {
    socketId: socket.id,
    folders: [],
    connected: true,
    lastSeen: new Date()
  });
  
  console.log(`User ${userId} connected with device ${deviceId}`);
  
  // Handle user announcement (with folders they have)
  socket.on('announce', (data) => {
    const now = Date.now();
    const lastAnnounce = announceTimestamps.get(socket.id) || 0;
    if (now - lastAnnounce < 5000) {
      console.log(`Throttling 'announce' from ${socket.id}`);
      return;
    }
    announceTimestamps.set(socket.id, now);
    
    console.log(`Announcement from ${userId}:`, data);
    
    // Update user's device info with the folders they have
    const deviceInfo = userDevices.get(deviceId);
    if (deviceInfo) {
      deviceInfo.folders = data.folders || [];
    }
    
    // Notify all other users' devices about this peer
    for (const [otherUserId, otherDevices] of connectedUsers.entries()) {
      // Don't announce to self
      if (otherUserId === userId) continue;
      
      for (const [otherDeviceId, otherDeviceInfo] of otherDevices.entries()) {
        // Skip offline devices
        if (!otherDeviceInfo.connected) continue;
        
        // Get socket for this device
        const otherSocket = io.sockets.sockets.get(otherDeviceInfo.socketId);
        if (otherSocket) {
          // Notify the other device about this peer joining
          otherSocket.emit('peer-joined', {
            id: socket.id,
            userId,
            deviceId,
            folders: data.folders || []
          });
          
          // Also notify this device about the other peer
          socket.emit('peer-joined', {
            id: otherDeviceInfo.socketId,
            userId: otherUserId,
            deviceId: otherDeviceId,
            folders: otherDeviceInfo.folders
          });
        }
      }
    }
  });
  
  // Handle WebRTC signaling
  socket.on('signal', (data) => {
    console.log(`Signal from ${socket.id} to ${data.to}`);
    
    // Find the target socket and forward the signal
    const targetSocket = io.sockets.sockets.get(data.to);
    if (targetSocket) {
      targetSocket.emit('signal', {
        from: socket.id,
        signal: data.signal
      });
    } else {
      console.log(`Target socket ${data.to} not found`);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Disconnection: ${socket.id} (${userId}, ${deviceId})`);
    
    // Update device status
    const userDevices = connectedUsers.get(userId);
    if (userDevices) {
      const deviceInfo = userDevices.get(deviceId);
      if (deviceInfo) {
        deviceInfo.connected = false;
        deviceInfo.lastSeen = new Date();
      }
      
      // If all devices for this user are disconnected, consider cleanup
      let allDisconnected = true;
      for (const device of userDevices.values()) {
        if (device.connected) {
          allDisconnected = false;
          break;
        }
      }
      
      if (allDisconnected) {
        // For now, keep the user info for reconnection
        // In a production system, you might want to clean up after a timeout
      }
    }
    
    // Notify all other connected users about this peer leaving
    for (const [otherUserId, otherDevices] of connectedUsers.entries()) {
      // Skip self
      if (otherUserId === userId) continue;
      
      for (const [otherDeviceId, otherDeviceInfo] of otherDevices.entries()) {
        // Skip offline devices
        if (!otherDeviceInfo.connected) continue;
        
        // Get socket for this device
        const otherSocket = io.sockets.sockets.get(otherDeviceInfo.socketId);
        if (otherSocket) {
          // Notify about peer leaving
          otherSocket.emit('peer-left', socket.id);
        }
      }
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`BlockSync Signaling Server running on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
});