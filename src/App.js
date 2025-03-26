import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from "firebase/app";
import { Upload, Download, Check, Copy, Link, FolderOpen, Settings, Plus, Trash, RefreshCw, FileText, Share2, HardDrive, Lock, ExternalLink, LogOut, User } from 'lucide-react';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import SimplePeer from 'simple-peer';
import io from 'socket.io-client';
import 'process/browser';
import { Buffer } from 'buffer';
window.Buffer = Buffer;

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCGDs0EY_JhI1uBrxrSzBcS6CUMug0VtOE",
  authDomain: "fyp2025-b929c.firebaseapp.com",
  projectId: "fyp2025-b929c",
  storageBucket: "fyp2025-b929c.firebasestorage.app",
  messagingSenderId: "293740592107",
  appId: "1:293740592107:web:3985834285dfa3c7e077ae",
  measurementId: "G-T5SWD1F845"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Signaling server URL - replace with your actual signaling server
const SIGNALING_SERVER = "http://localhost:3001";

const BlockSyncApp = () => {
  // Cross-tab communication channel for local testing
  const broadcastChannel = useRef(null);
  
  // WebRTC and signaling state
  const socket = useRef(null);
  const peers = useRef({});
  const dataChannels = useRef({});
  const pendingRequests = useRef({});
  const connectedPeers = useRef({});
  const [peerNetworkState, setPeerNetworkState] = useState({
    connected: false,
    peerCount: 0,
    networkId: null
  });
  
  // Chunk management for file transfers
  const chunkSize = 16384; // 16KB chunks
  const chunkTransfers = useRef({});
  
  // User state
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  
  // Main state
  const [syncFolders, setSyncFolders] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [folderFiles, setFolderFiles] = useState([]);
  const [notification, setNotification] = useState({ show: false, message: '', type: '' });
  const [activeTab, setActiveTab] = useState('folders');
  const [sharingModal, setSharingModal] = useState({ open: false, folder: null });
  const [newFolderModal, setNewFolderModal] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [uploadFormVisible, setUploadFormVisible] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [activeDevice] = useState({
    id: 'device_' + Math.random().toString(36).substr(2, 9),
    name: 'My Device',
    type: 'web',
    online: true
  });
  const [downloadProgress, setDownloadProgress] = useState({});
  
  // Setup cross-tab communication channel
  useEffect(() => {
    try {
      // BroadcastChannel API for cross-tab communication (for demo purposes)
      if (window.BroadcastChannel) {
        broadcastChannel.current = new BroadcastChannel('blocksync_channel');
        
        // Listen for incoming messages
        broadcastChannel.current.onmessage = (event) => {
          const { type, data } = event.data;
          
          if (type === 'FILE_SHARED') {
            handleIncomingFileShare(data);
          } else if (type === 'FOLDER_SHARED') {
            handleIncomingFolderShare(data);
          } else if (type === 'FOLDER_ADDED_BY_KEY') {
            // Handle folders added by key
            handleIncomingFolderFromKey(data);
          }
        };
      }
    } catch (error) {
      console.error('Error setting up broadcast channel:', error);
    }
    
    return () => {
      if (broadcastChannel.current) {
        broadcastChannel.current.close();
      }
    };
  }, []);

   // Instead of creating a new handleSignalEvent function, you should modify 
// the signal event listener within your WebRTC setup useEffect.

// Find this section in your useEffect that sets up WebRTC and update it:

// Setup WebRTC and signaling connection when user is authenticated
useEffect(() => {
  if (!user) return;
  
  // Initialize WebRTC peer connections
  const connectToPeerNetwork = async () => {
    try {
      // Connect to signaling server
      showNotification('Connecting to peer network...', 'info');
      const signalingServer = await connectToSignalingServer();
      
      // Update UI with connection state
      setPeerNetworkState(prev => ({
        ...prev,
        connected: true,
        networkId: signalingServer.networkId
      }));
      
      // Announce our presence and register for events
      signalingServer.announce({
        userId: user.uid,
        deviceId: activeDevice.id,
        folders: syncFolders.map(folder => ({
          id: folder.id,
          secretKey: folder.secretKey,
          shared: folder.shared
        }))
      });
      
      signalingServer.on('peer-joined', async (peerInfo) => {
        console.log(`🟢 Peer joined:`, peerInfo);
        
        // Get your socket ID for comparison
        const yourId = signalingServer.networkId;
        
        // Deterministic decision on who initiates based on socket ID
        const shouldInitiate = yourId.localeCompare(peerInfo.id) > 0;
        console.log(`Should initiate connection to ${peerInfo.id}? ${shouldInitiate}`);
        
        // Only create connection as initiator if we should be the initiator
        if (shouldInitiate) {
          console.log(`Creating connection to ${peerInfo.id} as initiator`);
          
          // Check if we already have a connection for this peer
          if (peers.current[peerInfo.id]) {
            console.log(`Already have a peer object for ${peerInfo.id}, destroying it first`);
            if (peers.current[peerInfo.id].destroy) {
              peers.current[peerInfo.id].destroy();
            } else if (peers.current[peerInfo.id].peer && peers.current[peerInfo.id].peer.destroy) {
              peers.current[peerInfo.id].peer.destroy();
            }
            delete peers.current[peerInfo.id];
          }
          
          // Create new connection
          const peerConnection = await createPeerConnection(peerInfo.id, true, signalingServer);
          peers.current[peerInfo.id] = peerConnection;
        } else {
          console.log(`Waiting for ${peerInfo.id} to initiate connection to us`);
          // We don't create a connection here - the other peer will initiate
        }
  
  // Check for common folders (keep this logic in both cases)
  const commonFolders = syncFolders.filter(folder => 
    peerInfo.folders.some(f => f.secretKey === folder.secretKey)
  );
  
  console.log(`Common folders with peer ${peerInfo.id}:`, commonFolders.length);
  
  if (commonFolders.length > 0) {
    // We have common folders with this peer, update folder device count
    commonFolders.forEach(folder => {
      // Update folder in state
      setSyncFolders(prev => prev.map(f => 
        f.id === folder.id
          ? { ...f, devices: f.devices + 1, peers: [...(f.peers || []), peerInfo.id] }
          : f
      ));
    });
  }
});
      
      // Listen for peer disconnect events
      signalingServer.on('peer-left', (peerId) => {
        console.log(`🔴 Peer left:`, peerId); // Enhanced logging
        
        // Clean up peer connection
        if (peers.current[peerId]) {
          safeDestroyPeer(peerId)
          delete peers.current[peerId];
        }
        
        if (connectedPeers.current[peerId]) {
          delete connectedPeers.current[peerId];
        }
        
        // Update folders that had this peer
        setSyncFolders(prev => prev.map(folder => {
          if (folder.peers && folder.peers.includes(peerId)) {
            return {
              ...folder,
              devices: Math.max(1, folder.devices - 1),
              peers: folder.peers.filter(p => p !== peerId)
            };
          }
          return folder;
        }));
        
        // Update peer count
        setPeerNetworkState(prev => ({
          ...prev,
          peerCount: Object.keys(connectedPeers.current).length
        }));
      });
      
      signalingServer.on('signal', async (data) => {
        const { from, signal } = data;
        
        console.log(`📥 Received signal from ${from}, type: ${signal.type || 'candidate'}`);
        console.log(`DEBUG: Current peers:`, Object.keys(peers.current));
        console.log(`DEBUG: Has peer ${from}?`, !!peers.current[from]);
        
        try {
          const yourId = signalingServer.networkId;
          const shouldBeInitiator = yourId.localeCompare(from) > 0;
          
          // Handle the case where we receive an offer but we should be initiator
          if (signal.type === 'offer' && shouldBeInitiator) {
            console.log(`Received offer from ${from} but we should be initiator. This is a race condition.`);
            
            // Conflict resolution: the peer with the "higher" ID wins and becomes initiator
            if (peers.current[from]) {
              console.log(`Destroying existing peer to resolve conflict`);
              if (peers.current[from].destroy) {
                peers.current[from].destroy();
              } else if (peers.current[from].peer && peers.current[from].peer.destroy) {
                peers.current[from].peer.destroy();
              }
              delete peers.current[from];
            }
            
            // Wait a random time (to avoid another race condition)
            const waitTime = Math.floor(Math.random() * 1000) + 500; // 500-1500ms
            console.log(`Waiting ${waitTime}ms before recreating connection`);
            
            setTimeout(async () => {
              console.log(`Creating new connection to ${from} after conflict resolution`);
              const peerConnection = await createPeerConnection(from, true, signalingServer);
              peers.current[from] = peerConnection;
            }, waitTime);
            
            return;
          }
          
          // If we don't have a connection to this peer yet, create one as receiver
          // but only if we should be the receiver
          if (!peers.current[from]) {
            if (!shouldBeInitiator && signal.type === 'offer') {
              console.log(`Creating new peer connection to ${from} as receiver`);
              const peerConnection = await createPeerConnection(from, false, signalingServer);
              peers.current[from] = peerConnection;
            } else if (shouldBeInitiator) {
              console.log(`Expected to be initiator for ${from}, not creating receiver connection`);
              return; // Don't process this signal
            } else {
              console.log(`No peer object for ${from} and signal is not an offer. Ignoring.`);
              return;
            }
          }
          
          // Process the signal if we have a valid peer
          if (peers.current[from] && peers.current[from].peer) {
            // Check if peer is destroyed before signaling
            if (!peers.current[from].peer._destroyed) {
              console.log(`Processing signal for peer ${from}`);
              peers.current[from].peer.signal(signal);
            } else {
              console.log(`Cannot process signal: Peer ${from} is destroyed`);
              // Remove destroyed peer from our records
              delete peers.current[from];
            }
          }
        } catch (error) {
          console.error(`Error processing signal for peer ${from}:`, error);
        }
      });
      
      // Store the socket reference
      socket.current = signalingServer;
      
      showNotification('Connected to peer network', 'success');
    } catch (error) {
      console.error('Failed to connect to peer network:', error);
      // Set offline mode instead of showing error
      showNotification('Operating in local mode (no peer connections)', 'info');
      // Set a limited connection state that won't trigger reconnection attempts
      setPeerNetworkState(prev => ({
        ...prev,
        connected: false,
        peerCount: 0,
        networkId: 'local-only'
      }));
    }
  };
  
  // Call the function to connect to the peer network
  connectToPeerNetwork();
  
  // Cleanup when component unmounts or user logs out
  return () => {
    // Disconnect from signaling server
    if (socket.current) {
      socket.current.disconnect();
    }
    
    // Close all peer connections
    Object.values(peers.current).forEach(peer => {
      if (peer && peer.destroy) {
        peer.destroy();
      }
    });
    
    // Clear all references
    peers.current = {};
    dataChannels.current = {};
    connectedPeers.current = {};
  };
}, [user, syncFolders, activeDevice.id]); // Include all dependencies used in the effect

// Add this improved helper function to safely destroy peers
const safeDestroyPeer = (peerId) => {
  try {
    const peer = peers.current[peerId];
    
    if (!peer) {
      console.log(`No peer object found for ${peerId}`);
      return;
    }
    
    console.log(`Attempting to safely destroy peer ${peerId}`);
    
    // Check different possible structures of the peer object
    if (typeof peer.destroy === 'function') {
      // If the peer wrapper has a destroy method
      console.log(`Using wrapper destroy() for peer ${peerId}`);
      peer.destroy();
    } else if (peer.peer && typeof peer.peer.destroy === 'function') {
      // If the peer has a nested peer object with destroy
      console.log(`Using peer.peer.destroy() for peer ${peerId}`);
      peer.peer.destroy();
    } else if (typeof peer._destroy === 'function') {
      // Some implementations might use _destroy
      console.log(`Using _destroy() for peer ${peerId}`);
      peer._destroy();
    } else {
      // As a last resort, if we have a SimplePeer instance
      console.log(`No standard destroy method found for peer ${peerId}`);
      
      // Try to close any data channels
      if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
        console.log(`Closing data channel for peer ${peerId}`);
        peer.dataChannel.close();
      }
      
      // If it's a SimplePeer instance itself
      if (peer._pc) {
        console.log(`Closing peer connection directly for ${peerId}`);
        peer._pc.close();
      }
    }
    
    // Remove the peer from our maps regardless of success
    delete peers.current[peerId];
    if (connectedPeers.current[peerId]) {
      delete connectedPeers.current[peerId];
    }
    
    console.log(`Peer ${peerId} removed from tracking maps`);
  } catch (error) {
    console.error(`Error destroying peer ${peerId}:`, error);
    // Ensure we remove references even if an error occurs
    delete peers.current[peerId];
    if (connectedPeers.current[peerId]) {
      delete connectedPeers.current[peerId];
    }
  }
};
  
  const connectToSignalingServer = async () => {
    return new Promise((resolve, reject) => {
      try {
        // Try to connect to the signaling server
        console.log(`Connecting to signaling server at ${SIGNALING_SERVER}`);
        
        const socketConnection = io(SIGNALING_SERVER, {
          transports: ['websocket'],
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          query: {
            userId: user.uid,
            deviceId: activeDevice.id
          }
        });
        
        // Set up event handlers
        socketConnection.on('connect', () => {
          console.log(`🟢 Connected to signaling server: ${socketConnection.id}`);
          
          // Create the signaling interface
          const signalingInterface = {
            announce: (data) => {
              console.log(`Announcing presence with folders:`, 
                         data.folders.map(f => f.secretKey));
              socketConnection.emit('announce', data);
            },
            on: (event, callback) => {
              socketConnection.on(event, callback);
            },
            send: (to, data) => {
              console.log(`Sending signal to ${to}, type: ${data.type || 'candidate'}`);
              socketConnection.emit('signal', { to, signal: data });
            },
            networkId: socketConnection.id,
            disconnect: () => {
              socketConnection.disconnect();
            }
          };
          
          resolve(signalingInterface);
        });
        
        socketConnection.on('connect_error', (err) => {
          console.error('Connection error:', err);
          reject(err);
        });
        
        socketConnection.on('connect_timeout', (err) => {
          console.error('Connection timeout:', err);
          reject(new Error('Connection timeout'));
        });
      } catch (error) {
        console.error('Error connecting to signaling server:', error);
        reject(error);
      }
    });
  };

  // Create a WebRTC peer connection
const createPeerConnection = async (peerId, initiator, signalingServer) => {
  return new Promise((resolve, reject) => {
    try {
      console.log(`📡 Creating peer connection to ${peerId}, initiator: ${initiator}`);
      
      // Create a new peer connection with robust options
      const peer = new SimplePeer({
        initiator,
        trickle: true,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        },
        // Reduced timeout settings for better reconnection
        offerConstraints: {
          offerToReceiveAudio: false,
          offerToReceiveVideo: false
        },
        sdpTransform: (sdp) => {
          // This ensures compatibility with more browsers
          return sdp;
        }
      });
      
      // Debug listeners to track ICE connection state
      peer._pc.addEventListener('iceconnectionstatechange', () => {
        try {
          // Check if peer._pc still exists before accessing it
          if (peer && peer._pc) {
            console.log(`🧊 ICE connection state for peer ${peerId}: ${peer._pc.iceConnectionState}`);
            
            if (peer._pc.iceConnectionState === 'disconnected' || 
                peer._pc.iceConnectionState === 'failed' ||
                peer._pc.iceConnectionState === 'closed') {
              console.log(`ICE connection ${peer._pc.iceConnectionState} for peer ${peerId}`);
            }
          }
        } catch (err) {
          console.log(`Error accessing ICE connection state: ${err.message}`);
        }
      });
      
      peer._pc.addEventListener('icegatheringstatechange', () => {
        console.log(`🧊 ICE gathering state for peer ${peerId}: ${peer._pc.iceGatheringState}`);
      });
      
      // IMPORTANT: Create a preliminary wrapper and store immediately
      // This ensures we can find the peer when signals arrive during connection
      const preliminaryWrapper = {
        peer,
        status: 'connecting',
        peerId
      };
      
      // Store immediately in peers.current
      peers.current[peerId] = preliminaryWrapper;
      console.log(`DEBUG: Stored preliminary peer ${peerId}. Current peers:`, Object.keys(peers.current));
      
      // Set up peer event handlers
      peer.on('error', err => {
        console.error(`❌ Peer connection error with ${peerId}:`, err);
        
        // Try to reconnect if this was an established connection
        if (connectedPeers.current[peerId]) {
          delete connectedPeers.current[peerId];
          
          // Update UI to reflect disconnection
          setPeerNetworkState(prev => ({
            ...prev,
            peerCount: Object.keys(connectedPeers.current).length
          }));
          
          reestablishPeerConnection(peerId, signalingServer)
            .catch(e => console.error('Failed to reestablish connection:', e));
        }
      });
      
      peer.on('signal', data => {
        // Send signal data to peer via signaling server
        console.log(`📤 Sending signal of type ${data.type || 'candidate'} to peer ${peerId}`);
        signalingServer.send(peerId, data);
      });
      
      peer.on('connect', () => {
        console.log(`🔗 Peer connection established with ${peerId}`);
        
        // Create data channel for file transfers
        const dataChannel = peer._channel;
        
        // Add peerId to the dataChannel for reference
        dataChannel.peerId = peerId;
        
        // Save the connection info
        connectedPeers.current[peerId] = {
          peer,
          dataChannel,
          status: 'connected',
          connectedAt: new Date()
        };
        
        // Create wrapper methods for easy data exchange
        const peerConnectionWrapper = {
          peer,
          dataChannel,
          send: (data) => {
            const serializedData = JSON.stringify(data);
            dataChannel.send(serializedData);
            return true;
          },
          destroy: () => {
            peer.destroy();
            delete connectedPeers.current[peerId];
            delete peers.current[peerId]; // Also remove from peers.current
          },
          requestFile: async (fileId, folderId, start, end) => {
            return requestFileChunk(dataChannel, fileId, start, end, folderId);
          }
        };

        peer._pc.addEventListener('iceconnectionstatechange', () => {
          console.log(`🧊 ICE connection state for peer ${peerId}: ${peer._pc.iceConnectionState}`);
          if (peer._pc.iceConnectionState === 'connected' || peer._pc.iceConnectionState === 'completed') {
            console.log(`✅ ICE connection ESTABLISHED with peer ${peerId}`);
          }
        });
        
        // Replace the preliminary wrapper with the complete one
        peers.current[peerId] = peerConnectionWrapper;
        
        console.log(`DEBUG: Updated peer ${peerId}. Current peers:`, Object.keys(peers.current));
        
        // Update the UI to show connected peers
        setPeerNetworkState(prevState => {
          const updatedState = {
            ...prevState,
            connected: true,
            peerCount: Object.keys(connectedPeers.current).length
          };
          console.log(`Updated peer state: ${JSON.stringify(updatedState)}`);
          return updatedState;
        });
        
        console.log(`Total connected peers: ${Object.keys(connectedPeers.current).length}`);
        
        // Test the connection with a ping
        try {
          console.log(`📤 Sending ping to peer ${peerId}`);
          dataChannel.send(JSON.stringify({
            type: 'PING',
            data: { timestamp: Date.now() }
          }));
        } catch (err) {
          console.error('Error sending ping:', err);
        }
        
        resolve(peerConnectionWrapper);
      });
      
      // Handle incoming data with better error handling
      peer.on('data', data => {
        try {
          // Log for debugging
          console.log(`📥 Received data from peer ${peerId}, type: ${typeof data}, size: ${typeof data === 'string' ? data.length : data.byteLength || 'unknown'} bytes`);
          
          // Check if it's binary data
          if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
            handleBinaryData(data, peerId);
            return;
          }
          
          // Try to parse as JSON if it's a string
          if (typeof data === 'string') {
            try {
              const message = JSON.parse(data);
              handlePeerMessage(message, peerId);
            } catch (e) {
              console.error(`Error parsing JSON from peer ${peerId}:`, e);
              console.log(`Raw data:`, data.slice(0, 100) + '...'); // Show first 100 chars
            }
          } else {
            // If already an object (not a string), pass it directly
            handlePeerMessage(data, peerId);
          }
        } catch (error) {
          console.error(`Error in data handler for peer ${peerId}:`, error);
        }
      });
      
      // Add this to your createPeerConnection function
peer.on('close', () => {
  console.log(`🔌 Peer connection closed: ${peerId}`);
  
  if (connectedPeers.current[peerId]) {
    delete connectedPeers.current[peerId];
  }
  
  // Also delete from peers.current
  delete peers.current[peerId];
  
  // Update peer count
  setPeerNetworkState(prev => ({
    ...prev,
    peerCount: Object.keys(connectedPeers.current).length
  }));
});
      
      // If this is a receiver (not initiator), resolve immediately
      // This ensures we can handle signals during connection setup
      if (!initiator) {
        resolve(preliminaryWrapper);
      }
      
    } catch (error) {
      console.error('Error creating peer connection:', error);
      reject(error);
    }
  });
};
  
  // Reestablish a peer connection
  const reestablishPeerConnection = async (peerId, signalingServer) => {
    try {
      console.log(`🔄 Attempting to reestablish connection with peer ${peerId}`);
      
      // Create a new peer connection as initiator
      const peerConnection = await createPeerConnection(peerId, true, signalingServer);
      
      // Update our tracked peers
      peers.current[peerId] = peerConnection;
      
      return peerConnection;
    } catch (error) {
      console.error('Failed to reestablish peer connection:', error);
      throw error;
    }
  };
  
  const handlePeerMessage = (message, peerId) => {
    console.log(`Handle message from peer ${peerId}, type: ${message.type}`);
    
    const { type, data } = message;
    
    switch (type) {
      case 'PING':
        console.log(`Received PING from peer ${peerId}, sending PONG`);
        sendPeerMessage(peerId, {
          type: 'PONG',
          data: { 
            timestamp: Date.now(),
            original: data.timestamp 
          }
        });
        break;
        
      case 'PONG':
        console.log(`Received PONG from peer ${peerId}, round-trip: ${Date.now() - data.timestamp}ms`);
        break;
        
      case 'FILE_REQUEST':
        // Another peer is requesting a file chunk from us
        handleFileRequest(data, peerId);
        break;
        
      case 'FILE_RESPONSE':
        // We received a file chunk response
        handleFileResponse(data);
        break;
        
      case 'FOLDER_SYNC':
        // A peer is sharing folder information
        handleFolderSync(data, peerId);
        break;
        
      case 'FOLDER_REQUEST':
        // A peer is requesting a folder with a specific secret key
        console.log(`🔍 Peer ${peerId} is requesting folder with key: ${data.secretKey}`);
        
        // Check if we have a folder with this secret key
        const requestedFolder = syncFolders.find(f => f.secretKey === data.secretKey);
        console.log(`🔍 Received folder request with key ${data.secretKey}. Found folder?: ${!!requestedFolder}`, 
          requestedFolder ? `(name: ${requestedFolder.name})` : '');
        
        if (requestedFolder) {
          console.log(`📂 Found requested folder: ${requestedFolder.name}`);
          
          // We have the folder, send a response with folder info
          const folderInfo = {
            id: requestedFolder.id,
            name: requestedFolder.name,
            path: requestedFolder.path,
            size: requestedFolder.size,
            secretKey: requestedFolder.secretKey,
            shareMode: requestedFolder.shareMode,
            version: requestedFolder.version,
            encrypted: requestedFolder.encrypted,
            color: requestedFolder.color,
            files: requestedFolder.files.map(file => ({
              id: file.id,
              name: file.name,
              size: file.size,
              type: file.type
            }))
          };
          
          // Send the response
          console.log(`📤 Sending folder response to peer ${peerId} for request ${data.requestId}`);
          
          const responsePayload = {
            type: 'FOLDER_RESPONSE',
            data: {
              requestId: data.requestId,
              folderInfo
            }
          };
          
          // Use the direct dataChannel for more reliable delivery
          try {
            const peer = connectedPeers.current[peerId];
            if (peer && peer.dataChannel && peer.dataChannel.readyState === 'open') {
              peer.dataChannel.send(JSON.stringify(responsePayload));
            } else {
              console.error(`Cannot send FOLDER_RESPONSE: Data channel not ready for peer ${peerId}`);
            }
          } catch (err) {
            console.error(`Error sending folder response to peer ${peerId}:`, err);
          }
        } else {
          console.log(`❌ No folder found with key: ${data.secretKey}`);
          // We don't have this folder, send empty response
          sendPeerMessage(peerId, {
            type: 'FOLDER_RESPONSE',
            data: {
              requestId: data.requestId,
              folderInfo: null
            }
          });
        }
        break;
        
      case 'FILE_AVAILABLE':
        // A peer has a file available
        handleFileAvailable(data, peerId);
        break;
        
      default:
        console.log('Unknown message type:', type);
    }
  };
  
  // Handle binary data (file chunks) from peers
  const handleBinaryData = (data, peerId) => {
    console.log(`📦 Received binary data from peer ${peerId}, size: ${data.byteLength || 'unknown'} bytes`);
    
    // Check if this is for a pending file request
    const pendingReq = Object.values(pendingRequests.current).find(
      req => req.peerId === peerId && req.status === 'waiting'
    );
    
    if (pendingReq) {
      console.log(`Found matching pending request for binary data: ${pendingReq.id}`);
      // This is data for a pending request
      pendingReq.status = 'received';
      pendingReq.data = data;
      pendingReq.resolve(data);
    } else {
      console.log('Received unexpected binary data from peer:', peerId);
    }
  };
  
  // Handle file request from a peer
  const handleFileRequest = async (request, peerId) => {
    const { fileId, folderId, chunkStart, chunkEnd, requestId } = request;
    
    try {
      // Find the folder and file
      const folder = syncFolders.find(f => f.id === folderId);
      if (!folder) {
        sendPeerMessage(peerId, {
          type: 'FILE_RESPONSE',
          data: {
            requestId,
            error: 'Folder not found'
          }
        });
        return;
      }
      
      const file = folder.files.find(f => f.id === fileId);
      if (!file) {
        sendPeerMessage(peerId, {
          type: 'FILE_RESPONSE',
          data: {
            requestId,
            error: 'File not found'
          }
        });
        return;
      }
      
      // Check if we have the file locally
      if (!file.url) {
        sendPeerMessage(peerId, {
          type: 'FILE_RESPONSE',
          data: {
            requestId,
            error: 'File not available locally'
          }
        });
        return;
      }
      
      // Fetch the file data
      const response = await fetch(file.url);
      const fileData = await response.arrayBuffer();
      
      // Get the requested chunk
      const chunk = fileData.slice(chunkStart, chunkEnd);
      
      // Send response with chunk data
      sendPeerMessage(peerId, {
        type: 'FILE_RESPONSE',
        data: {
          requestId,
          fileId,
          folderId,
          chunkStart,
          chunkEnd,
          totalSize: fileData.byteLength,
          success: true
        }
      });
      
      // Send the binary data directly
      const peer = connectedPeers.current[peerId];
      if (peer && peer.dataChannel && peer.dataChannel.readyState === 'open') {
        peer.dataChannel.send(new Uint8Array(chunk));
      }
    } catch (error) {
      console.error('Error handling file request:', error);
      
      // Send error response
      sendPeerMessage(peerId, {
        type: 'FILE_RESPONSE',
        data: {
          requestId,
          error: error.message
        }
      });
    }
  };
  
  // Handle file response from a peer
  const handleFileResponse = (response) => {
    const { requestId, error, success } = response;
    
    // Check if we have a pending request with this ID
    const pendingReq = pendingRequests.current[requestId];
    if (!pendingReq) {
      console.log('Received response for unknown request:', requestId);
      return;
    }
    
    if (error) {
      // The request failed
      pendingReq.status = 'error';
      pendingReq.error = error;
      pendingReq.reject(new Error(error));
    } else if (success) {
      // The chunk data will come separately as binary data
      // Mark as waiting for binary data
      pendingReq.status = 'waiting';
      
      // The actual resolution happens in handleBinaryData when the chunk arrives
    }
  };

  // Handle folder sync from a peer
  const handleFolderSync = (folderInfo, peerId) => {
    const { folderId, secretKey, files } = folderInfo;
    
    // Check if we already have this folder
    const existingFolder = syncFolders.find(f => f.secretKey === secretKey);
    if (existingFolder) {
      // We already have this folder, check if we need to update file list
      const missingFiles = files.filter(peerFile => 
        !existingFolder.files.some(ourFile => ourFile.id === peerFile.id)
      );
      
      if (missingFiles.length > 0) {
        // We're missing some files that the peer has
        showNotification(`Found ${missingFiles.length} new files in shared folder`, 'info');
        
        // Update folder in state, marking files as not synced but available from peer
        const newFiles = missingFiles.map(file => ({
          ...file,
          synced: false,
          availableFrom: [...(file.availableFrom || []), peerId]
        }));
        
        // Add the files to our folder
        setSyncFolders(prev => prev.map(folder => {
          if (folder.id === existingFolder.id) {
            return {
              ...folder,
              files: [...folder.files, ...newFiles]
            };
          }
          return folder;
        }));
        
        // If this is the current folder, update the view
        if (currentFolder && currentFolder.id === existingFolder.id) {
          const newFolderFiles = newFiles.map(file => ({
            ...file,
            path: `${currentFolder.path}/${file.name}`
          }));
          
          setFolderFiles(prev => [...prev, ...newFolderFiles]);
        }
      }
    } else {
      // We don't have this folder, but we have a connection to a peer who does
      // Ask if the user wants to add this folder
      if (window.confirm(`Peer has a shared folder that you don't have. Add "${folderInfo.name}"?`)) {
        // Add the folder from the peer info
        addFolderFromPeer(folderInfo, peerId);
      }
    }
  };
  
  // Handle file available notification from a peer
  const handleFileAvailable = (fileInfo, peerId) => {
    const { fileId, folderId } = fileInfo;
    
    // Check if we have this folder
    const folder = syncFolders.find(f => f.id === folderId);
    if (!folder) return;
    
    // Check if we have this file and need to update its availability
    setSyncFolders(prev => prev.map(f => {
      if (f.id === folderId) {
        const updatedFiles = f.files.map(file => {
          if (file.id === fileId) {
            // Add this peer to the list of peers that have this file
            const availableFrom = [...(file.availableFrom || [])];
            if (!availableFrom.includes(peerId)) {
              availableFrom.push(peerId);
            }
            
            return {
              ...file,
              availableFrom
            };
          }
          return file;
        });
        
        return {
          ...f,
          files: updatedFiles
        };
      }
      return f;
    }));
    
    // If this is the current folder, update the view
    if (currentFolder && currentFolder.id === folderId) {
      setFolderFiles(prev => prev.map(file => {
        if (file.id === fileId) {
          const availableFrom = [...(file.availableFrom || [])];
          if (!availableFrom.includes(peerId)) {
            availableFrom.push(peerId);
          }
          
          return {
            ...file,
            availableFrom
          };
        }
        return file;
      }));
    }
  };
  
  // Send a message to a specific peer
  const sendPeerMessage = (peerId, message) => {
    const peer = connectedPeers.current[peerId];
    if (!peer || !peer.dataChannel) {
      console.error(`❌ Unable to send message to peer: ${peerId} - No data channel`);
      return false;
    }
    
    if (peer.dataChannel.readyState !== 'open') {
      console.error(`❌ Data channel not open for peer ${peerId}. State: ${peer.dataChannel.readyState}`);
      return false;
    }
    
    try {
      console.log(`📤 Sending message to peer ${peerId}:`, message.type);
      peer.dataChannel.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending message to peer:', error);
      return false;
    }
  };

  // Broadcast folder added by key to other tabs
const broadcastFolderAddedByKey = (folder, files) => {
  if (!broadcastChannel.current) {
    console.log('BroadcastChannel not available');
    return false;
  }
  
  try {
    // Convert dates to strings for sharing
    const folderToShare = {
      ...folder,
      created: folder.created.toISOString(),
      modified: folder.modified.toISOString()
    };
    
    // Broadcast folder and files to other tabs
    broadcastChannel.current.postMessage({
      type: 'FOLDER_ADDED_BY_KEY',
      data: {
        folder: folderToShare,
        files: files,
        secretKey: folder.secretKey
      }
    });
    
    console.log(`Broadcasted folder ${folder.name} to other tabs`);
    return true;
  } catch (error) {
    console.error('Error broadcasting folder added by key:', error);
    return false;
  }
};
  
  // Broadcast a message to all connected peers
  const broadcastToPeers = (message) => {
    let successCount = 0;
    
    Object.keys(connectedPeers.current).forEach(peerId => {
      if (sendPeerMessage(peerId, message)) {
        successCount++;
      }
    });
    
    console.log(`📢 Broadcast message sent to ${successCount} peers`);
    return successCount;
  };
  
  // Request a file chunk from a peer
  const requestFileChunk = async (dataChannel, fileId, chunkStart, chunkEnd, folderId) => {
    return new Promise((resolve, reject) => {
      // Generate a unique request ID
      const requestId = 'req_' + Math.random().toString(36).substr(2, 9);
      
      // Store this request
      pendingRequests.current[requestId] = {
        id: requestId,
        fileId,
        folderId,
        chunkStart,
        chunkEnd,
        status: 'pending',
        createdAt: new Date(),
        peerId: dataChannel.peerId, // Assuming we added peerId to the dataChannel
        resolve,
        reject
      };
      
      // Set a timeout for this request
      const timeout = setTimeout(() => {
        if (pendingRequests.current[requestId] && 
            pendingRequests.current[requestId].status !== 'received') {
          pendingRequests.current[requestId].status = 'timeout';
          pendingRequests.current[requestId].reject(new Error('Request timed out'));
          delete pendingRequests.current[requestId];
        }
      }, 30000); // 30 second timeout
      
      // Send the request
      try {
        dataChannel.send(JSON.stringify({
          type: 'FILE_REQUEST',
          data: {
            requestId,
            fileId,
            folderId,
            chunkStart,
            chunkEnd
          }
        }));
      } catch (error) {
        clearTimeout(timeout);
        delete pendingRequests.current[requestId];
        reject(error);
      }
    });
  };
  
  // Download a file from peers
  const downloadFileFromPeers = async (file, folder) => {
    // Check if the file is already available locally
    if (file.synced && file.url) {
      return file;
    }
    
    // Check if we have peers that have this file
    if (!file.availableFrom || file.availableFrom.length === 0) {
      throw new Error('No peers have this file');
    }
    
    // Use the first available peer
    const peerId = file.availableFrom[0];
    const peer = connectedPeers.current[peerId];
    
    if (!peer) {
      throw new Error('Peer connection not available');
    }
    
    // Start the download process
    try {
      // Show progress in UI
      setDownloadProgress({
        fileId: file.id,
        progress: 0,
        status: 'starting'
      });
      
      // Request file metadata first
      const metadataResponse = await peer.requestFile(file.id, folder.id, 0, 0);
      
      // The response should include the total file size
      const totalSize = metadataResponse.totalSize || file.size;
      const chunks = Math.ceil(totalSize / chunkSize);
      const fileChunks = new Array(chunks);
      
      // Initialize array buffer to store the full file
      const fileData = new Uint8Array(totalSize);
      
      // Download the chunks
      let downloaded = 0;
      const concurrentRequests = 3; // Number of chunks to download concurrently
      
      // Process chunks in batches
      for (let i = 0; i < chunks; i += concurrentRequests) {
        const chunkPromises = [];
        
        // Create promises for concurrent chunk downloads
        for (let j = 0; j < concurrentRequests && i + j < chunks; j++) {
          const chunkIndex = i + j;
          const chunkStart = chunkIndex * chunkSize;
          const chunkEnd = Math.min(chunkStart + chunkSize, totalSize);
          
          chunkPromises.push(
            peer.requestFile(file.id, folder.id, chunkStart, chunkEnd)
              .then(chunkData => {
                // Store the chunk
                fileChunks[chunkIndex] = chunkData;
                downloaded += chunkData.byteLength;
                
                // Update progress
                setDownloadProgress({
                  fileId: file.id,
                  progress: Math.round((downloaded / totalSize) * 100),
                  status: 'downloading'
                });
                
                return chunkData;
              })
          );
        }
        
        // Wait for this batch of chunks
        await Promise.all(chunkPromises);
      }
      
      // Combine all chunks into a single array buffer
      let offset = 0;
      for (const chunk of fileChunks) {
        fileData.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }
      
      // Create a blob from the file data
      const blob = new Blob([fileData], { type: getMimeTypeFromFileName(file.name) });
      const fileUrl = URL.createObjectURL(blob);
      
      // Update file in state
      const updatedFile = {
        ...file,
        url: fileUrl,
        synced: true,
        size: totalSize
      };
      
      // Update the folder in state
      setSyncFolders(prev => prev.map(f => {
        if (f.id === folder.id) {
          const updatedFiles = f.files.map(fileItem => 
            fileItem.id === file.id ? updatedFile : fileItem
          );
          
          return {
            ...f,
            files: updatedFiles
          };
        }
        return f;
      }));
      
      // Update the folderFiles view if this is the current folder
      if (currentFolder && currentFolder.id === folder.id) {
        setFolderFiles(prev => prev.map(fileItem => 
          fileItem.id === file.id ? {
            ...updatedFile,
            path: `${folder.path}/${file.name}`
          } : fileItem
        ));
      }
      
      // Add a transaction record
      const transaction = {
        hash: '0x' + Math.random().toString(16).substr(2, 40),
        timestamp: new Date().toISOString(),
        sender: peerId,
        fileInfo: {
          name: file.name,
          size: totalSize,
          type: file.type,
          infoHash: file.id,
          folderId: folder.id
        }
      };
      
      setTransactions(prev => [transaction, ...prev]);
      
      // Clear progress indicator
      setDownloadProgress({
        fileId: file.id,
        progress: 100,
        status: 'complete'
      });
      
      // Return the updated file
      return updatedFile;
    } catch (error) {
      // Show error in UI
      setDownloadProgress({
        fileId: file.id,
        progress: 0,
        status: 'error',
        error: error.message
      });
      
      throw error;
    }
  };
  
  // Add a folder from peer information
  const addFolderFromPeer = (folderInfo, peerId) => {
    console.log(`📁 Adding folder from peer ${peerId}:`, folderInfo);
    
    const { name, secretKey, files } = folderInfo;
    
    // Create a new folder object
    const newFolder = {
      id: 'shared' + Math.random().toString(36).substr(2, 9),
      name: name || 'Shared Folder',
      path: folderInfo.path || `/shared-folders/${name.toLowerCase().replace(/\s+/g, '-')}`,
      size: folderInfo.size || 0,
      created: new Date(),
      modified: new Date(),
      shared: true,
      shareMode: 'read-only',
      secretKey: secretKey,
      version: folderInfo.version || 1,
      devices: folderInfo.devices || 2,
      syncEnabled: true,
      encrypted: folderInfo.encrypted || true,
      owner: false,
      files: files.map(file => ({
        ...file,
        synced: false,
        availableFrom: [peerId]
      })),
      color: folderInfo.color || '#EC4899',
      peers: [peerId]
    };
    
    // Add folder to state
    setSyncFolders(prev => [...prev, newFolder]);
    
    // Set as current folder
    setCurrentFolder(newFolder);
    
    // Create folder files for the view
    const viewFiles = newFolder.files.map(file => ({
      ...file,
      path: `${newFolder.path}/${file.name}`
    }));
    
    setFolderFiles(viewFiles);
    
    showNotification(`Added shared folder from peer: ${newFolder.name}`, 'success');
    
    return newFolder;
  };
  
  // Initialize app and check for user login
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        const loggedInUser = {
          uid: user.uid,
          displayName: user.displayName,
          email: user.email,
          photoURL: user.photoURL
        };
        setUser(loggedInUser);
        localStorage.setItem('blocksync_user', JSON.stringify(loggedInUser));
        
        // Load user data once logged in
        loadUserData(user.uid);
      } else {
        setUser(null);
      }
      setIsAuthLoading(false);
    });
  
    return () => unsubscribe();
  }, []);
  
  // Load user data from localStorage
  const loadUserData = (userId) => {
    try {
      // Load folders
      const foldersKey = `blocksync_folders_${userId}`;
      const storedFolders = localStorage.getItem(foldersKey);
      
      if (storedFolders) {
        const parsedFolders = JSON.parse(storedFolders);
        
        // Convert date strings back to Date objects
        const foldersWithDates = parsedFolders.map(folder => ({
          ...folder,
          created: new Date(folder.created),
          modified: new Date(folder.modified)
        }));
        
        setSyncFolders(foldersWithDates);
      }
      
      // Load transactions
      const transactionsKey = `blocksync_transactions_${userId}`;
      const storedTransactions = localStorage.getItem(transactionsKey);
      
      if (storedTransactions) {
        setTransactions(JSON.parse(storedTransactions));
      }
    } catch (error) {
      console.error('Error loading user data:', error);
      showNotification('Error loading your data', 'error');
    }
  };
  
  // Save user data to localStorage
  const saveUserData = () => {
    if (!user) return;
    
    try {
      // Save folders - Convert dates to strings for storage
      const foldersToSave = syncFolders.map(folder => ({
        ...folder,
        created: folder.created.toISOString(),
        modified: folder.modified.toISOString()
      }));
      
      const foldersKey = `blocksync_folders_${user.uid}`;
      localStorage.setItem(foldersKey, JSON.stringify(foldersToSave));
      
      // Save transactions
      const transactionsKey = `blocksync_transactions_${user.uid}`;
      localStorage.setItem(transactionsKey, JSON.stringify(transactions));
    } catch (error) {
      console.error('Error saving user data:', error);
      showNotification('Error saving your data', 'error');
    }
  };
  
  // Save data when it changes
  useEffect(() => {
    if (user) {
      saveUserData();
    }
  }, [syncFolders, transactions, user]);
  
  // Sign in with Google
  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
  
      const newUser = {
        uid: user.uid,
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL
      };
  
      localStorage.setItem('blocksync_user', JSON.stringify(newUser));
      setUser(newUser);
      showNotification('Signed in successfully', 'success');
    } catch (error) {
      console.error("Error signing in: ", error);
      showNotification('Sign-in failed', 'error');
    }
  };
  
  // Sign out
  const handleSignOut = async () => {
    try {
      // Disconnect from peer network
      if (socket.current) {
        socket.current.disconnect();
      }
      
      // Close all peer connections
      Object.values(peers.current).forEach(peer => {
        if (peer && peer.destroy) {
          peer.destroy();
        }
      });
      
      // Sign out from Firebase
      await signOut(auth);
      localStorage.removeItem('blocksync_user');
      setUser(null);
      setSyncFolders([]);
      setCurrentFolder(null);
      setFolderFiles([]);
      showNotification('Signed out successfully', 'info');
    } catch (error) {
      console.error("Error signing out: ", error);
      showNotification('Sign-out failed', 'error');
    }
  };
  
  // Function to show notifications
  const showNotification = (message, type = 'info') => {
    setNotification({ show: true, message, type });
    setTimeout(() => {
      setNotification({ show: false, message: '', type: '' });
    }, 3000);
  };
  
  // Format file size
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    if (!bytes) return '0 B';
    
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    else if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    else return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };
  
  // Format date relative to now
  const formatRelativeDate = (date) => {
    if (!date) return '';
    
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    
    if (diffDay > 0) {
      return diffDay === 1 ? 'Yesterday' : `${diffDay} days ago`;
    } else if (diffHour > 0) {
      return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
    } else if (diffMin > 0) {
      return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
    } else {
      return 'Just now';
    }
  };
  
  // Helper to determine file type from filename
  const getFileTypeFromName = (filename) => {
    const extension = filename.split('.').pop().toLowerCase();
    
    const typeMap = {
      // Documents
      'doc': 'document', 'docx': 'document', 'pdf': 'document', 'txt': 'document', 'rtf': 'document',
      // Spreadsheets
      'xls': 'spreadsheet', 'xlsx': 'spreadsheet', 'csv': 'spreadsheet',
      // Presentations
      'ppt': 'presentation', 'pptx': 'presentation',
      // Images
      'jpg': 'image', 'jpeg': 'image', 'png': 'image', 'gif': 'image', 'svg': 'image', 'webp': 'image',
      // Audio
      'mp3': 'audio', 'wav': 'audio', 'ogg': 'audio',
      // Video
      'mp4': 'video', 'avi': 'video', 'mov': 'video', 'mkv': 'video', 'webm': 'video'
    };
    
    return typeMap[extension] || 'other';
  };
  
  // Get file type icon
  const getFileTypeIcon = (file) => {
    switch (file.type) {
      case 'document': return <FileText size={20} className="text-blue-500" />;
      case 'spreadsheet': return <FileText size={20} className="text-green-500" />;
      case 'presentation': return <FileText size={20} className="text-red-500" />;
      case 'image': return <FileText size={20} className="text-purple-500" />;
      case 'video': return <FileText size={20} className="text-red-500" />;
      case 'audio': return <FileText size={20} className="text-yellow-500" />;
      default: return <FileText size={20} className="text-gray-500" />;
    }
  };
  
  // Create default files for shared folder
  const createDefaultFiles = () => {
    // List of default files with consistent IDs for sharing
    return [
      {
        id: 'file_default_doc1',
        name: 'document1.txt',
        size: 150,
        type: 'document',
        content: 'This is the content of document 1. It contains important information for the project.',
        modified: new Date(),
        version: 1,
        synced: true
      },
      {
        id: 'file_default_doc2',
        name: 'document2.txt',
        size: 120,
        type: 'document',
        content: 'Document 2 contains additional data that supplements document 1.',
        modified: new Date(),
        version: 1,
        synced: true
      },
      {
        id: 'file_default_plan',
        name: 'project_plan.txt',
        size: 200,
        type: 'document',
        content: 'Project Plan:\n1. Initial research\n2. Design phase\n3. Implementation\n4. Testing\n5. Deployment',
        modified: new Date(),
        version: 1,
        synced: true
      },
      {
        id: 'file_default_readme',
        name: 'readme.md',
        size: 180,
        type: 'document',
        content: '# BlockSync Project\nThis folder contains shared files for the BlockSync project.',
        modified: new Date(),
        version: 1,
        synced: true
      }
    ];
  };
  
  // Create a new sync folder
  const createSyncFolder = (folderData) => {
    const newFolder = {
      id: 'folder' + Math.random().toString(36).substr(2, 9),
      name: folderData.name,
      path: folderData.path || `/${folderData.name.toLowerCase().replace(/\s+/g, '-')}`,
      size: 0,
      created: new Date(),
      modified: new Date(),
      shared: folderData.shared || false,
      shareMode: folderData.shareMode || 'read-write',
      secretKey: 'B' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      version: 1,
      devices: 1,
      syncEnabled: true,
      encrypted: folderData.encrypted || true,
      owner: true,
      files: [],
      color: folderData.color || '#4F46E5'
    };
    
    // Add folder to state
    setSyncFolders(prevFolders => [...prevFolders, newFolder]);
    setNewFolderModal(false);
    showNotification(`Folder "${folderData.name}" created successfully`, 'success');
    
    // Automatically select the new folder
    setCurrentFolder(newFolder);
    
    // If connected to peer network, announce the new folder
    if (socket.current) {
      // Announce this folder to the network
      socket.current.announce({
        userId: user.uid,
        deviceId: activeDevice.id,
        folders: [{
          id: newFolder.id,
          secretKey: newFolder.secretKey,
          shared: newFolder.shared
        }]
      });
    }
    
    return newFolder;
  };
  
  // Request a folder from peers by secretKey
  const requestFolderFromPeers = async (secretKey) => {
    const connectedPeerIds = Object.keys(connectedPeers.current);
    console.log(`🔍 Looking for folder with key ${secretKey} among ${connectedPeerIds.length} peers`);
    
    if (connectedPeerIds.length === 0) {
      console.log('❌ No connected peers available');
      return null;
    }
    
    // Create a unique request ID
    const requestId = 'folderReq_' + Math.random().toString(36).substr(2, 9);
    
    // Create a promise that will be resolved when we get a response
    return new Promise((resolve) => {
      // Store responding peers
      const respondingPeers = [];
      
      // Setup response handlers for each peer
      for (const peerId of connectedPeerIds) {
        const peer = connectedPeers.current[peerId];
        if (!peer || !peer.dataChannel || peer.dataChannel.readyState !== 'open') {
          console.log(`❌ Peer ${peerId} not available (${peer?.dataChannel?.readyState || 'no data channel'})`);
          continue;
        }
        
        console.log(`📤 Sending folder request to peer ${peerId} for key ${secretKey}`);
        
        // Create a handler specific to this peer - with proper closure over peerId
        const responseHandler = function(event) {
          try {
            // Safely convert data to string if needed
            const dataStr = typeof event.data === 'string' ? event.data : 
                           (event.data instanceof ArrayBuffer || event.data instanceof Uint8Array) ? 
                           new TextDecoder().decode(event.data) : JSON.stringify(event.data);
            
            const message = JSON.parse(dataStr);
            
            console.log(`Received message from peer ${peerId}, type: ${message.type}`);
            
            if (message.type === 'FOLDER_RESPONSE' && 
                message.data && 
                message.data.requestId === requestId) {
              
              console.log(`✅ Got folder response from peer ${peerId}:`, 
                        message.data.folderInfo ? 'Found folder' : 'No folder found');
              
              // Remove this handler
              peer.dataChannel.removeEventListener('message', responseHandler);
              
              // Store the response if folder was found
              if (message.data.folderInfo) {
                respondingPeers.push({
                  peerId,
                  folderInfo: message.data.folderInfo
                });
                
                // Immediately resolve if we found the folder
                resolve(respondingPeers[0]);
              }
            }
          } catch (error) {
            console.error(`Error handling message from peer ${peerId}:`, error);
          }
        };
        
        // Add the event listener
        peer.dataChannel.addEventListener('message', responseHandler);
        
        // Store the handler for cleanup in the timeout
        if (!peer.tempHandlers) peer.tempHandlers = {};
        peer.tempHandlers[requestId] = responseHandler;
        
        // Send the request
        try {
          const requestPayload = {
            type: 'FOLDER_REQUEST',
            data: {
              secretKey,
              requestId
            }
          };
          
          console.log(`Sending folder request to peer ${peerId}:`, requestPayload);
          
          // Use the raw data channel to ensure message is delivered
          peer.dataChannel.send(JSON.stringify(requestPayload));
        } catch (err) {
          console.error(`Error sending folder request to peer ${peerId}:`, err);
          // Clean up the handler if send fails
          peer.dataChannel.removeEventListener('message', responseHandler);
          if (peer.tempHandlers) delete peer.tempHandlers[requestId];
        }
      }
      
      // Set a timeout to resolve with whatever we've got
      setTimeout(() => {
        // Clean up all handlers
        connectedPeerIds.forEach(peerId => {
          const peer = connectedPeers.current[peerId];
          if (peer && peer.dataChannel && peer.tempHandlers && peer.tempHandlers[requestId]) {
            try {
              peer.dataChannel.removeEventListener('message', peer.tempHandlers[requestId]);
            } catch (err) {
              console.error(`Error removing event listener:`, err);
            }
            delete peer.tempHandlers[requestId];
          }
        });
        
        // Resolve with the first response if any, otherwise null
        if (respondingPeers.length > 0) {
          resolve(respondingPeers[0]);
        } else {
          console.log(`⏰ Timeout: No peers responded with folder info for key ${secretKey}`);
          resolve(null);
        }
      }, 10000); // 10 second timeout
    });
  };

  const addFolderByKey = async (secretKey) => {
    // Validate that a key was provided
    if (!secretKey || secretKey.trim() === '') {
      showNotification('Please enter a valid share key', 'error');
      return;
    }
    
    // Check if this folder is already added
    const existingFolder = syncFolders.find(folder => folder.secretKey === secretKey);
    if (existingFolder) {
      showNotification('This folder is already in your library', 'error');
      return;
    }
    
    showNotification('Connecting to shared folder...', 'info');
    
    // Log connected peers and check data channel states
    const connectedPeerIds = Object.keys(connectedPeers.current);
    console.log(`Connected peers: ${connectedPeerIds.length}`, connectedPeerIds);
    for (const peerId of connectedPeerIds) {
      const peer = connectedPeers.current[peerId];
      const readyState = peer?.dataChannel?.readyState;
      console.log(`Peer ${peerId} data channel state: ${readyState || 'unknown'}`);
    }
    
    let peerFolderFound = false;
    
    if (connectedPeerIds.length > 0) {
      try {
        // Create a unique request ID for this folder request
        const requestId = 'folderReq_' + Math.random().toString(36).substr(2, 9);
        console.log(`Searching for folder with key ${secretKey} among ${connectedPeerIds.length} peers...`);
        
        // Store responses from peers
        const responses = [];
        
        // Create a promise that will resolve when a response is received or timeout occurs
        const folderRequestPromise = new Promise((resolveRequest) => {
          connectedPeerIds.forEach(peerId => {
            const peer = connectedPeers.current[peerId];
            if (!peer || !peer.dataChannel || peer.dataChannel.readyState !== 'open') {
              console.log(`Skipping peer ${peerId}: data channel not ready`);
              return;
            }
            
            console.log(`Sending folder request to peer ${peerId}`);
            
            // Define a handler for this specific peer
            const messageHandler = function(event) {
              try {
                const message = JSON.parse(event.data);
                console.log(`Received message from peer ${peerId}:`, message.type);
                
                // Check if this is a response to our folder request
                if (message.type === 'FOLDER_RESPONSE' &&
                    message.data &&
                    message.data.requestId === requestId) {
                  console.log(`Got folder response from peer ${peerId}`);
                  if (message.data.folderInfo) {
                    console.log(`Peer ${peerId} has folder with key ${secretKey}`);
                    responses.push({
                      peerId,
                      folderInfo: message.data.folderInfo
                    });
                    
                    // Remove this handler since we got our response
                    try {
                      peer.dataChannel.removeEventListener('message', messageHandler);
                    } catch (err) {
                      console.error('Error removing message handler:', err);
                    }
                    resolveRequest(true);
                  }
                }
              } catch (error) {
                console.error(`Error handling message from peer ${peerId}:`, error);
              }
            };
            
            try {
              // Add the event listener and store it for cleanup
              peer.dataChannel.addEventListener('message', messageHandler);
              if (!peer.tempHandlers) peer.tempHandlers = {};
              peer.tempHandlers[requestId] = messageHandler;
              
              // Send the folder request to the peer
              peer.dataChannel.send(JSON.stringify({
                type: 'FOLDER_REQUEST',
                data: {
                  secretKey,
                  requestId
                }
              }));
              console.log(`Folder request sent to peer ${peerId}`);
            } catch (error) {
              console.error(`Error setting up request to peer ${peerId}:`, error);
            }
          });
          
          // Set a timeout to resolve the promise after 15 seconds if no valid response is received
          setTimeout(() => {
            console.log('Folder request timeout after 15 seconds');
            resolveRequest(false);
          }, 15000);
        });
        
        // Wait for the folder request to complete
        await folderRequestPromise;
        
        // Clean up all event listeners
        connectedPeerIds.forEach(peerId => {
          const peer = connectedPeers.current[peerId];
          if (peer && peer.dataChannel && peer.tempHandlers && peer.tempHandlers[requestId]) {
            try {
              peer.dataChannel.removeEventListener('message', peer.tempHandlers[requestId]);
            } catch (err) {
              console.error('Error removing event listener:', err);
            }
            delete peer.tempHandlers[requestId];
          }
        });
        
        console.log(`Folder request completed. Found ${responses.length} responses.`);
        
        // If any peer responded with folder info, use the first response
        if (responses.length > 0) {
          const { peerId, folderInfo } = responses[0];
          console.log(`Using folder info from peer ${peerId}:`, folderInfo);
          const newFolder = addFolderFromPeer(folderInfo, peerId);
          if (newFolder) {
            peerFolderFound = true;
            showNotification(`Added shared folder: ${newFolder.name}`, 'success');
            return newFolder;
          }
        } else {
          console.log('No peers responded with folder info');
        }
      } catch (error) {
        console.error('Error in peer folder request:', error);
      }
    } else {
      console.log('No connected peers available');
    }
    
    // If no valid folder was found from peers, return null
    return null;
  };
  
  // Handle incoming folder from key from other tabs
  const handleIncomingFolderFromKey = (data) => {
    const { folder, files, secretKey } = data;
    
    // Check if we already have this folder
    const existingFolder = syncFolders.find(f => f.secretKey === secretKey);
    if (existingFolder) {
      console.log('Folder with this key already exists');
      return;
    }
    
    try {
      // Add the folder to our state with the same files
      const newFolder = {
        ...folder,
        created: new Date(folder.created),
        modified: new Date(folder.modified)
      };
      
      // Create transaction records for the files
      const newTransactions = files.map(file => ({
        hash: '0x' + Math.random().toString(16).substr(2, 40),
        timestamp: new Date().toISOString(),
        sender: 'remote_device',
        fileInfo: {
          name: file.name,
          size: file.size,
          type: file.type,
          infoHash: file.id,
          folderId: newFolder.id
        }
      }));
      
      // Add transactions
      setTransactions(prev => [...newTransactions, ...prev]);
      
      // Add folder with files to state
      setSyncFolders(prev => [...prev, newFolder]);
      
      // If no current folder is selected, set this as current
      if (!currentFolder) {
        setCurrentFolder(newFolder);
        
        // Create folder files for the view
        const fullFiles = files.map(file => ({
          ...file,
          path: `${newFolder.path}/${file.name}`
        }));
        
        setFolderFiles(fullFiles);
      }
      
      // Show notification
      showNotification(`Received shared folder: ${newFolder.name}`, 'success');
    } catch (error) {
      console.error('Error handling incoming folder:', error);
    }
  };
  
  // Add specific files to a folder
  const addSpecificFilesToFolder = (folderId, filesData) => {
    const folder = syncFolders.find(f => f.id === folderId);
    if (!folder) {
      showNotification('Folder not found', 'error');
      return;
    }
    
    // Process each file
    const processedFiles = [];
    filesData.forEach(fileData => {
      // Generate a unique file ID
      const fileId = fileData.id || 'file_' + Math.random().toString(36).substr(2, 9);
      
      // Create a blob for the content
      const content = new Blob(
        [fileData.content || `This is the content of ${fileData.name}`], 
        { type: 'text/plain' }
      );
      
      // Create a URL for the blob
      const fileUrl = URL.createObjectURL(content);
      
      // Create file object
      const fileObj = {
        id: fileId,
        name: fileData.name,
        size: content.size,
        type: fileData.type || getFileTypeFromName(fileData.name),
        url: fileUrl,
        modified: new Date(),
        version: 1,
        synced: true
      };
      
      processedFiles.push(fileObj);
      
      // Create transaction record
      const transaction = {
        hash: '0x' + Math.random().toString(16).substr(2, 40),
        timestamp: new Date().toISOString(),
        sender: 'local_device',
        fileInfo: {
          name: fileData.name,
          size: content.size,
          type: fileObj.type,
          infoHash: fileId,
          folderId: folderId
        }
      };
      
      // Add transaction
      setTransactions(prev => [transaction, ...prev]);
    });
    
    // Calculate total size
    const totalSize = processedFiles.reduce((sum, file) => sum + file.size, 0);
    
    // Update folder with new files
    setSyncFolders(prev => {
      return prev.map(folder => {
        if (folder.id === folderId) {
          return {
            ...folder,
            files: [...(folder.files || []), ...processedFiles],
            size: folder.size + totalSize,
            modified: new Date()
          };
        }
        return folder;
      });
    });
    
    // Update current folder view if needed
    if (currentFolder && currentFolder.id === folderId) {
      // Create full file objects for the view
      const fullFiles = processedFiles.map(file => ({
        ...file,
        path: `${currentFolder.path}/${file.name}`
      }));
      
      setFolderFiles(prev => [...prev, ...fullFiles]);
      
      // Update current folder state
      setCurrentFolder(prevFolder => {
        if (!prevFolder) return null;
        
        return {
          ...prevFolder,
          files: [...(prevFolder.files || []), ...processedFiles],
          size: prevFolder.size + totalSize,
          modified: new Date()
        };
      });
    }
    
    // Share with other tabs
    shareFilesWithOtherTabs(processedFiles, folderId);
    
    // If this is a shared folder, announce the new files to peers
    if (folder.shared && Object.keys(connectedPeers.current).length > 0) {
      // Create file available messages for each new file
      processedFiles.forEach(file => {
        const fileAvailableMessage = {
          type: 'FILE_AVAILABLE',
          data: {
            fileId: file.id,
            folderId: folder.id,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type
          }
        };
        
        // Broadcast to all peers
        broadcastToPeers(fileAvailableMessage);
      });
    }
    
    showNotification(`Added ${filesData.length} files to folder`, 'success');
  };
  
  // Add default files to a folder
  const addDefaultFilesToFolder = (folderId) => {
    // Add the files to the folder
    addSpecificFilesToFolder(folderId, createDefaultFiles());
  };
  
  // Toggle sync for a folder
  const toggleFolderSync = (folderId) => {
    setSyncFolders(prev => prev.map(folder => 
      folder.id === folderId 
        ? { ...folder, syncEnabled: !folder.syncEnabled } 
        : folder
    ));
    
    // If disabling sync, we can notify peers if needed
    const folder = syncFolders.find(f => f.id === folderId);
    if (folder && folder.syncEnabled && folder.shared && Object.keys(connectedPeers.current).length > 0) {
      const syncUpdateMessage = {
        type: 'FOLDER_SYNC_STATUS',
        data: {
          folderId: folder.id,
          syncEnabled: false
        }
      };
      
      // Broadcast to peers who have this folder
      if (folder.peers && folder.peers.length > 0) {
        folder.peers.forEach(peerId => {
          if (connectedPeers.current[peerId]) {
            sendPeerMessage(peerId, syncUpdateMessage);
          }
        });
      } else {
        // If we don't know which peers have this folder, broadcast to all
        broadcastToPeers(syncUpdateMessage);
      }
    }
  };
  
  // Delete a folder
  const deleteFolder = (folderId) => {
    // Remove any files related to this folder
    const folder = syncFolders.find(f => f.id === folderId);
    if (folder && folder.files) {
      folder.files.forEach(file => {
        if (file.url) {
          URL.revokeObjectURL(file.url);
        }
      });
    }
    
    // If this is a shared folder, notify peers if needed
    if (folder && folder.shared && Object.keys(connectedPeers.current).length > 0) {
      const folderDeleteMessage = {
        type: 'FOLDER_REMOVED',
        data: {
          folderId: folder.id
        }
      };
      
      // Broadcast to peers who have this folder
      if (folder.peers && folder.peers.length > 0) {
        folder.peers.forEach(peerId => {
          if (connectedPeers.current[peerId]) {
            sendPeerMessage(peerId, folderDeleteMessage);
          }
        });
      }
    }
    
    setSyncFolders(prev => prev.filter(folder => folder.id !== folderId));
    
    if (currentFolder && currentFolder.id === folderId) {
      setCurrentFolder(null);
      setFolderFiles([]);
    }
    
    showNotification('Folder removed', 'info');
  };
  
  // Share a folder
  const shareFolder = (folder) => {
    setSharingModal({ open: true, folder });
    
    // Also share with other browser tabs for demo
    shareWithOtherTabs(folder);
    
    // If connected to peers, make this folder available on the network
    if (Object.keys(connectedPeers.current).length > 0) {
      // Update folder to be shared
      setSyncFolders(prev => prev.map(f => 
        f.id === folder.id ? { ...f, shared: true } : f
      ));
      
      // Announce this folder to the network
      if (socket.current) {
        socket.current.announce({
          userId: user.uid,
          deviceId: activeDevice.id,
          folders: [{
            id: folder.id,
            secretKey: folder.secretKey,
            shared: true
          }]
        });
      }
      
      // Broadcast folder sync message to all peers
      const folderSyncMessage = {
        type: 'FOLDER_SYNC',
        data: {
          folderId: folder.id,
          secretKey: folder.secretKey,
          name: folder.name,
          path: folder.path,
          files: folder.files.map(file => ({
            id: file.id,
            name: file.name,
            size: file.size,
            type: file.type
          }))
        }
      };
      
      broadcastToPeers(folderSyncMessage);
    }
  };
  
  // Share a folder with other tabs
  const shareWithOtherTabs = (folder) => {
    if (!broadcastChannel.current) {
      showNotification('Cross-tab sharing is not available', 'error');
      return false;
    }
    
    try {
      // Convert dates to strings for sharing
      const folderToShare = {
        ...folder,
        created: folder.created.toISOString(),
        modified: folder.modified.toISOString()
      };
      
      broadcastChannel.current.postMessage({
        type: 'FOLDER_SHARED',
        data: folderToShare
      });
      
      return true;
    } catch (error) {
      console.error('Error sharing folder with other tabs:', error);
      return false;
    }
  };
  
  // Copy share key to clipboard
  const copyShareKey = (key) => {
    try {
      navigator.clipboard.writeText(key).then(() => {
        showNotification('Share key copied to clipboard', 'success');
      });
    } catch (e) {
      console.error("Error copying to clipboard:", e);
      // Fallback method
      const textArea = document.createElement("textarea");
      textArea.value = key;
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        showNotification('Share key copied to clipboard', 'success');
      } catch (err) {
        showNotification('Unable to copy to clipboard', 'error');
      }
      document.body.removeChild(textArea);
    }
  };
  
  // Truncate blockchain hash
  const truncateHash = (hash) => {
    if (!hash) return '';
    return hash.substring(0, 6) + '...' + hash.substring(hash.length - 4);
  };
  
  // Get status color class
  const getSyncStatusColor = (folder) => {
    if (!folder.syncEnabled) return 'bg-gray-400';
    return 'bg-green-500';
  };
  
  // Handle incoming file share from another tab
  const handleIncomingFileShare = (data) => {
    const { files, folderId } = data;
    
    // Check if we have the folder
    const targetFolder = syncFolders.find(f => f.id === folderId);
    if (!targetFolder) {
      console.log('Folder not found for incoming file share');
      return;
    }
    
    // Process files
    let totalSize = 0;
    const newTransactions = [];
    const processedFiles = [];
    
    // Convert data URLs back to file objects
    files.forEach(fileData => {
      // Create a transaction record
      const transaction = {
        hash: '0x' + Math.random().toString(16).substr(2, 40),
        timestamp: new Date().toISOString(),
        sender: 'remote_device',
        fileInfo: {
          name: fileData.name,
          size: fileData.size,
          type: fileData.type,
          infoHash: fileData.id,
          folderId: folderId
        }
      };
      
      newTransactions.push(transaction);
      totalSize += fileData.size;
      
      processedFiles.push({
        id: fileData.id,
        name: fileData.name,
        size: fileData.size,
        url: fileData.url,
        type: fileData.type,
        modified: new Date(),
        version: 1,
        synced: true
      });
    });
    
    // Update transactions
    setTransactions(prev => [...newTransactions, ...prev]);
    
    // Update folders
    setSyncFolders(prev => {
      return prev.map(folder => {
        if (folder.id === folderId) {
          const updatedFiles = [...(folder.files || []), ...processedFiles];
          return {
            ...folder,
            files: updatedFiles,
            size: folder.size + totalSize,
            modified: new Date()
          };
        }
        return folder;
      });
    });
    
    // If this is the current folder, update folder files too
    if (currentFolder && currentFolder.id === folderId) {
      // Create full file objects for the current view
      const newFolderFiles = processedFiles.map(file => ({
        ...file,
        path: `${currentFolder.path}/${file.name}`
      }));
      
      setFolderFiles(prev => [...prev, ...newFolderFiles]);
      
      // Update current folder
      setCurrentFolder(prevFolder => {
        if (!prevFolder) return null;
        
        const updatedFiles = [...(prevFolder.files || []), ...processedFiles];
        return {
          ...prevFolder,
          files: updatedFiles,
          size: prevFolder.size + totalSize,
          modified: new Date()
        };
      });
    }
    
    showNotification(`Received ${files.length} file${files.length !== 1 ? 's' : ''} from another device`, 'success');
  };
  
  // Handle incoming folder share from another tab
  const handleIncomingFolderShare = (data) => {
    // Check if we already have this folder
    const existingFolder = syncFolders.find(f => f.id === data.id);
    if (existingFolder) {
      showNotification('This folder is already in your library', 'info');
      return;
    }
    
    // Add the folder
    const newFolder = {
      ...data,
      created: new Date(data.created),
      modified: new Date(data.modified)
    };
    
    setSyncFolders(prev => [...prev, newFolder]);
    showNotification(`Received shared folder: ${data.name}`, 'success');
  };
  
  // Share files with other tabs
  const shareFilesWithOtherTabs = (files, folderId) => {
    if (!broadcastChannel.current) {
      console.log('Cross-tab sharing is not available');
      return false;
    }
    
    try {
      broadcastChannel.current.postMessage({
        type: 'FILE_SHARED',
        data: {
          files,
          folderId
        }
      });
      
      return true;
    } catch (error) {
      console.error('Error sharing files with other tabs:', error);
      return false;
    }
  };
  
  // Handle file upload
  const handleFileUpload = (event) => {
    if (!currentFolder) {
      showNotification('Please select a folder first', 'error');
      return;
    }
    
    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    
    // Display selected files
    setSelectedFiles(files);
    
    // Process each file
    const updatedFolderFiles = [...folderFiles];
    const newTransactions = [];
    let totalSize = 0;
    
    const processedFiles = files.map(file => {
      const fileId = 'file_' + Math.random().toString(36).substr(2, 9);
      const fileUrl = URL.createObjectURL(file);
      
      // Create file object
      const fileObj = {
        id: fileId,
        name: file.name,
        size: file.size,
        modified: new Date(),
        type: getFileTypeFromName(file.name),
        version: 1,
        synced: true,
        path: `${currentFolder.path}/${file.name}`,
        url: fileUrl
      };
      
      // Add to folder files array
      updatedFolderFiles.push(fileObj);

      // Create transaction record
      const transaction = {
        hash: '0x' + Math.random().toString(16).substr(2, 40),
        timestamp: new Date().toISOString(),
        sender: activeDevice.id,
        fileInfo: {
          name: file.name,
          size: file.size,
          type: file.type,
          infoHash: fileId,
          folderId: currentFolder.id
        }
      };
      
      newTransactions.push(transaction);
      totalSize += file.size;
      
      // Return simplified version for folder state
      return {
        id: fileId,
        name: file.name,
        size: file.size,
        url: fileUrl,
        type: getFileTypeFromName(file.name),
        modified: new Date(),
        version: 1,
        synced: true
      };
    });
    
    // Update state in one batch for each type of state
    setFolderFiles(updatedFolderFiles);
    setTransactions(prev => [...newTransactions, ...prev]);
    
    // Update the folder in syncFolders state
    setSyncFolders(prev => {
      return prev.map(folder => {
        if (folder.id === currentFolder.id) {
          const updatedFiles = [...(folder.files || []), ...processedFiles];
          return {
            ...folder,
            files: updatedFiles,
            size: folder.size + totalSize,
            modified: new Date()
          };
        }
        return folder;
      });
    });
    
    // Update current folder to match
    setCurrentFolder(prevFolder => {
      if (!prevFolder) return null;
      
      const updatedFiles = [...(prevFolder.files || []), ...processedFiles];
      return {
        ...prevFolder,
        files: updatedFiles,
        size: prevFolder.size + totalSize,
        modified: new Date()
      };
    });
    
    // Share with other tabs if available
    shareFilesWithOtherTabs(processedFiles, currentFolder.id);
    
    // If this is a shared folder, announce the new files to peers
    if (currentFolder.shared && Object.keys(connectedPeers.current).length > 0) {
      processedFiles.forEach(file => {
        const fileAvailableMessage = {
          type: 'FILE_AVAILABLE',
          data: {
            fileId: file.id,
            folderId: currentFolder.id,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type
          }
        };
        
        // Broadcast to peers who have this folder
        if (currentFolder.peers && currentFolder.peers.length > 0) {
          currentFolder.peers.forEach(peerId => {
            if (connectedPeers.current[peerId]) {
              sendPeerMessage(peerId, fileAvailableMessage);
            }
          });
        } else {
          // If we don't know which peers have this folder, broadcast to all
          broadcastToPeers(fileAvailableMessage);
        }
      });
    }
    
    // Reset form
    event.target.value = null;
    setSelectedFiles([]);
    setUploadFormVisible(false);
    
    showNotification(`${files.length} file${files.length !== 1 ? 's' : ''} added successfully`, 'success');
  };
  
  // Download a file
  const downloadFile = (file) => {
    if (file.url) {
      // If we have a direct URL (from browser storage), use it
      const a = document.createElement('a');
      a.href = file.url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      showNotification(`File "${file.name}" downloaded`, 'success');
    } else if (file.synced === false && file.availableFrom && file.availableFrom.length > 0) {
      // If file is not synced but peers have it, download from peers
      showNotification('Downloading file from peers...', 'info');
      
      // Start the download process in background
      downloadFileFromPeers(file, currentFolder)
        .then(downloadedFile => {
          showNotification(`File "${file.name}" downloaded from peer`, 'success');
          
          // Create a direct download link
          const a = document.createElement('a');
          a.href = downloadedFile.url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        })
        .catch(error => {
          console.error('Error downloading file from peers:', error);
          showNotification(`Failed to download file: ${error.message}`, 'error');
        });
    } else {
      // File not available locally or from peers, show error
      showNotification('File not available', 'error');
    }
  };
  
  // Calculate mime type from file name
  const getMimeTypeFromFileName = (filename) => {
    const extension = filename.split('.').pop().toLowerCase();
    
    const mimeTypes = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'txt': 'text/plain',
      'html': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'json': 'application/json',
      'zip': 'application/zip',
      'rar': 'application/x-rar-compressed',
      'tar': 'application/x-tar',
      '7z': 'application/x-7z-compressed'
    };
    
    return mimeTypes[extension] || 'application/octet-stream';
  };
  
  // Load files for a folder when selected
  useEffect(() => {
    if (currentFolder) {
      const folder = syncFolders.find(f => f.id === currentFolder.id);
      
      if (folder) {
        // Update current folder reference to ensure it's the latest version
        setCurrentFolder(folder);
        
        // Process and display files
        if (folder.files && folder.files.length > 0) {
          const fullFiles = folder.files.map(fileRef => ({
            ...fileRef,
            path: `${folder.path}/${fileRef.name}`
          }));
          
          setFolderFiles(fullFiles);
        } else {
          setFolderFiles([]);
        }
      } else {
        // If selected folder no longer exists
        setCurrentFolder(null);
        setFolderFiles([]);
      }
    }
  }, [currentFolder, syncFolders]);
  
  // If authentication is loading, show a loading screen
  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <RefreshCw className="animate-spin h-12 w-12 text-blue-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-700">Loading BlockSync...</h1>
        </div>
      </div>
    );
  }
  
  // If user is not logged in, show the login screen
  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
          <div className="text-center mb-8">
            <RefreshCw className="h-12 w-12 text-blue-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-800">BlockSync</h1>
            <p className="text-gray-600 mt-2">Secure P2P file sharing with blockchain metadata</p>
          </div>
          
          <button 
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-3 px-4 rounded-lg flex items-center justify-center gap-2"
            onClick={signInWithGoogle}
          >
            <User size={20} />
            Sign in to continue
          </button>
          
          <p className="text-center text-sm text-gray-500 mt-6">
            By signing in, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    );
  }
  
  // Main application UI when user is logged in
  return (
    <div className="flex flex-col w-full h-screen bg-gray-50 text-gray-800">
      {/* Header */}
      <header className="p-4 bg-white shadow-sm border-b">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <RefreshCw className="text-blue-500" />
            BlockSync
          </h1>
          
          <div className="flex items-center gap-4">
            {/* P2P Network Status */}
            <div className="text-sm flex items-center gap-2 bg-blue-50 p-1 px-2 rounded-full">
              <div className={`w-2 h-2 rounded-full ${peerNetworkState.connected ? 'bg-green-500' : 'bg-gray-400'}`}></div>
              <span>
                {peerNetworkState.peerCount} peer{peerNetworkState.peerCount !== 1 ? 's' : ''}
              </span>
            </div>
            
            {/* Device info */}
            <div className="text-sm flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <span>My Device</span>
            </div>
            
            {/* User info */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-500">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName} className="w-full h-full rounded-full" />
                ) : (
                  <User size={18} />
                )}
              </div>
              <div className="text-sm">
                <p className="font-medium">{user.displayName}</p>
                <p className="text-xs text-gray-500">{user.email}</p>
              </div>
            </div>
            
            {/* Settings and logout */}
            <div className="flex items-center gap-2">
              <button className="p-2 rounded-full text-gray-500 hover:bg-gray-100">
                <Settings size={20} />
              </button>
              <button 
                className="p-2 rounded-full text-gray-500 hover:bg-gray-100"
                onClick={handleSignOut}
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </div>
      </header>
      
      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 bg-white border-r overflow-y-auto p-4">
          {/* Tabs */}
          <div className="flex border-b mb-4">
            <button 
              className={`flex-1 pb-2 font-medium text-sm ${activeTab === 'folders' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-500'}`}
              onClick={() => setActiveTab('folders')}
            >
              Folders
            </button>
            <button 
              className={`flex-1 pb-2 font-medium text-sm ${activeTab === 'devices' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-500'}`}
              onClick={() => setActiveTab('devices')}
            >
              Devices
            </button>
          </div>
          
          {/* Folders tab */}
          {activeTab === 'folders' && (
            <div className="space-y-4">
              {/* Add buttons */}
              <div className="flex gap-2">
                <button 
                  className="flex-1 bg-blue-500 text-white rounded-md p-2 text-sm font-medium flex items-center justify-center gap-1"
                  onClick={() => setNewFolderModal(true)}
                >
                  <Plus size={16} />
                  Add Folder
                </button>
                <button 
                  className="flex-1 bg-gray-100 text-gray-700 rounded-md p-2 text-sm font-medium flex items-center justify-center gap-1"
                  onClick={() => {
                    const key = prompt('Enter share key:');
                    if (key) addFolderByKey(key);
                  }}
                >
                  <Link size={16} />
                  Enter Key
                </button>
              </div>
              
              {/* Folder list */}
              <div className="space-y-2">
                {syncFolders.length === 0 ? (
                  <div className="text-center py-6 text-gray-500">
                    <p>No folders yet</p>
                    <p className="text-sm">Create a new folder to get started</p>
                  </div>
                ) : (
                  syncFolders.map(folder => (
                    <div 
                      key={folder.id} 
                      className={`p-3 rounded-lg cursor-pointer ${currentFolder && currentFolder.id === folder.id ? 'bg-blue-50 border border-blue-100' : 'hover:bg-gray-50'}`}
                      onClick={() => setCurrentFolder(folder)}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-md flex items-center justify-center text-white`} style={{ backgroundColor: folder.color }}>
                          <FolderOpen size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-sm truncate">{folder.name}</h3>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span>{formatFileSize(folder.size)}</span>
                            <span>•</span>
                            <div className="flex items-center gap-1">
                              <div className={`w-2 h-2 rounded-full ${getSyncStatusColor(folder)}`}></div>
                              {folder.syncEnabled ? 'Synced' : 'Paused'}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end text-xs text-gray-500">
                          <div className="flex items-center gap-1">
                            {folder.encrypted && <Lock size={12} />}
                            {folder.shared && <Share2 size={12} />}
                          </div>
                          <span>v{folder.version}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          
          {/* Devices tab */}
          {activeTab === 'devices' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-medium text-sm">Connected Devices</h3>
                <button className="text-blue-500 hover:text-blue-700 text-sm">
                  <RefreshCw size={14} />
                </button>
              </div>
              
              {/* My device */}
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-blue-500 flex items-center justify-center text-white">
                    <HardDrive size={18} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-sm">{activeDevice.name} (This device)</h3>
                    <p className="text-xs text-gray-500">ID: {truncateHash(activeDevice.id)}</p>
                  </div>
                  <div className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span>Online</span>
                  </div>
                </div>
              </div>
              
              {/* Connected peer devices */}
              {Object.keys(connectedPeers.current).map(peerId => (
                <div key={peerId} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-gray-500 flex items-center justify-center text-white">
                      <HardDrive size={18} />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium text-sm">Peer Device</h3>
                      <p className="text-xs text-gray-500">ID: {truncateHash(peerId)}</p>
                    </div>
                    <div className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div>
                      <span>Connected</span>
                    </div>
                  </div>
                </div>
              ))}
              
              {/* Offline devices - would be populated from historical connection data */}
            </div>
          )}
        </div>
        
        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          {currentFolder ? (
            <div className="p-6">
              {/* Folder header */}
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-md flex items-center justify-center text-white`} style={{ backgroundColor: currentFolder.color }}>
                    <FolderOpen size={22} />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold">{currentFolder.name}</h2>
                    <p className="text-sm text-gray-500">
                      {formatFileSize(currentFolder.size)} • {currentFolder.devices} device{currentFolder.devices !== 1 ? 's' : ''}
                      <span className="ml-2 text-xs text-gray-400">Last modified: {formatRelativeDate(currentFolder.modified)}</span>
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button 
                    className={`p-2 rounded-md ${currentFolder.syncEnabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}
                    onClick={() => toggleFolderSync(currentFolder.id)}
                  >
                    <RefreshCw size={18} />
                  </button>
                  <button 
                    className="p-2 rounded-md bg-blue-100 text-blue-700"
                    onClick={() => shareFolder(currentFolder)}
                  >
                    <Share2 size={18} />
                  </button>
                  <button 
                    className="p-2 rounded-md bg-red-100 text-red-700"
                    onClick={() => {
                      if (window.confirm(`Are you sure you want to remove ${currentFolder.name}?`)) {
                        deleteFolder(currentFolder.id);
                      }
                    }}
                  >
                    <Trash size={18} />
                  </button>
                </div>
              </div>
              
              {/* Upload form */}
              <div className="mb-6">
                {uploadFormVisible ? (
                  <div className="bg-white shadow-sm rounded-lg p-4">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="font-medium">Upload Files</h3>
                      <button 
                        className="text-gray-500 hover:text-gray-700"
                        onClick={() => setUploadFormVisible(false)}
                      >
                        &times;
                      </button>
                    </div>
                    
                    <div className="mb-4">
                      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center relative">
                        {selectedFiles.length > 0 ? (
                          <div>
                            <p className="font-medium">Selected Files:</p>
                            <ul className="text-sm text-gray-600 mt-2">
                              {selectedFiles.map((file, index) => (
                                <li key={index}>{file.name} ({formatFileSize(file.size)})</li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center">
                            <Upload size={32} className="text-gray-400 mb-2" />
                            <p className="text-gray-500">Drag and drop files or click to browse</p>
                          </div>
                        )}
                        <input 
                          type="file" 
                          onChange={handleFileUpload}
                          multiple
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button 
                      className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg p-3 flex items-center justify-center gap-2"
                      onClick={() => setUploadFormVisible(true)}
                    >
                      <Upload size={18} />
                      Upload Files
                    </button>
                    
                    <button 
                      className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium rounded-lg p-3 flex items-center justify-center gap-2"
                      onClick={() => addDefaultFilesToFolder(currentFolder.id)}
                    >
                      <Plus size={18} />
                      Add Sample Files
                    </button>
                  </div>
                )}
              </div>
              
              {/* Files */}
              <div className="bg-white shadow-sm rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b">
                  <h3 className="font-medium">Files</h3>
                </div>
                
                {folderFiles.length > 0 ? (
                  <table className="w-full">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Name</th>
                        <th className="px-4 py-2 text-left font-medium">Size</th>
                        <th className="px-4 py-2 text-left font-medium">Modified</th>
                        <th className="px-4 py-2 text-left font-medium">Version</th>
                        <th className="px-4 py-2 text-left font-medium">Status</th>
                        <th className="px-4 py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {folderFiles.map(file => (
                        <tr key={file.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {getFileTypeIcon(file)}
                              <span className="font-medium text-sm">{file.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">{formatFileSize(file.size)}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{formatRelativeDate(file.modified)}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">v{file.version}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs ${file.synced ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'} px-2 py-1 rounded`}>
                              {file.synced ? 'Synced' : 'Pending'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button 
                              className="p-1 text-gray-500 hover:text-blue-500"
                              onClick={() => downloadFile(file)}
                            >
                              <Download size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-8 text-center text-gray-500">
                    <p>No files in this folder yet</p>
                    <div className="flex justify-center gap-4 mt-4">
                      <button 
                        className="text-blue-500 hover:text-blue-700 text-sm font-medium"
                        onClick={() => setUploadFormVisible(true)}
                      >
                        Upload files
                      </button>
                      <button 
                        className="text-blue-500 hover:text-blue-700 text-sm font-medium"
                        onClick={() => addDefaultFilesToFolder(currentFolder.id)}
                      >
                        Add sample files
                      </button>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Blockchain Transactions */}
              <div className="mt-6 bg-white shadow-sm rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b flex justify-between items-center">
                  <h3 className="font-medium">Blockchain Metadata</h3>
                  <button className="text-xs text-blue-500 flex items-center gap-1">
                    <ExternalLink size={12} />
                    View on Explorer
                  </button>
                </div>
                
                {transactions.filter(tx => tx.fileInfo && tx.fileInfo.folderId === currentFolder.id).length > 0 ? (
                  <div className="divide-y">
                    {transactions
                      .filter(tx => tx.fileInfo && tx.fileInfo.folderId === currentFolder.id)
                      .slice(0, 5)
                      .map((tx, index) => (
                        <div key={index} className="p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium text-sm">{tx.fileInfo.name}</p>
                              <p className="text-xs text-gray-500">{formatFileSize(tx.fileInfo.size)}</p>
                            </div>
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                              {truncateHash(tx.hash)}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {new Date(tx.timestamp).toLocaleString()}
                          </p>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-gray-500">
                    <p>No blockchain transactions for this folder yet</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-6 flex flex-col items-center justify-center h-full text-center">
              <div className="mb-4 text-gray-400">
                <FolderOpen size={64} />
              </div>
              <h2 className="text-xl font-semibold mb-2">No Folder Selected</h2>
              <p className="text-gray-500 mb-6 max-w-md">Select a folder from the sidebar or create a new one to get started</p>
              <div className="flex gap-4">
                <button 
                  className="bg-blue-500 text-white rounded-md py-2 px-4 font-medium"
                  onClick={() => setNewFolderModal(true)}
                >
                  Add New Folder
                </button>
                <button 
                  className="bg-gray-100 text-gray-700 rounded-md py-2 px-4 font-medium"
                  onClick={() => {
                    const key = prompt('Enter share key:');
                    if (key) addFolderByKey(key);
                  }}
                >
                  Connect to Shared Folder
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Sharing modal */}
      {sharingModal.open && sharingModal.folder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-4">Share "{sharingModal.folder.name}"</h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Share Key</label>
              <div className="flex">
                <input
                  type="text"
                  value={sharingModal.folder.secretKey}
                  readOnly
                  className="flex-1 p-2 border rounded-l-md bg-gray-50"
                />
                <button
                  onClick={() => copyShareKey(sharingModal.folder.secretKey)}
                  className="bg-gray-100 border border-l-0 rounded-r-md p-2 px-3 hover:bg-gray-200"
                >
                  <Copy size={18} />
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Share this key with others to give them access to this folder
              </p>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Permission</label>
              <select 
                className="w-full p-2 border rounded-md"
                value={sharingModal.folder.shareMode}
                onChange={(e) => {
                  setSyncFolders(prev => prev.map(folder => 
                    folder.id === sharingModal.folder.id 
                      ? { ...folder, shareMode: e.target.value }
                      : folder
                  ));
                  setSharingModal(prev => ({
                    ...prev,
                    folder: { ...prev.folder, shareMode: e.target.value }
                  }));
                }}
              >
                <option value="read-only">Read Only</option>
                <option value="read-write">Read & Write</option>
              </select>
            </div>
            
            <div className="mb-6">
              <label className="flex items-center">
                <input 
                  type="checkbox"
                  checked={sharingModal.folder.encrypted}
                  onChange={(e) => {
                    setSyncFolders(prev => prev.map(folder => 
                      folder.id === sharingModal.folder.id 
                        ? { ...folder, encrypted: e.target.checked }
                        : folder
                    ));
                    setSharingModal(prev => ({
                      ...prev,
                      folder: { ...prev.folder, encrypted: e.target.checked }
                    }));
                  }}
                  className="mr-2"
                />
                <span className="text-sm">Encrypt data transfers</span>
              </label>
            </div>
            
            <div className="flex justify-end gap-2">
              <button 
                className="px-4 py-2 border rounded-md"
                onClick={() => setSharingModal({ open: false, folder: null })}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* New folder modal */}
      {newFolderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-4">Add New Folder</h3>
            
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target);
              const folderData = {
                name: formData.get('name'),
                path: formData.get('path'),
                shared: formData.get('shared') === 'on',
                shareMode: formData.get('shareMode') || 'read-write',
                encrypted: formData.get('encrypted') === 'on',
                color: formData.get('color')
              };
              createSyncFolder(folderData);
            }}>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1" htmlFor="name">Folder Name</label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  className="w-full p-2 border rounded-md"
                  placeholder="My Folder"
                />
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1" htmlFor="path">Folder Path (optional)</label>
                <input
                  type="text"
                  id="path"
                  name="path"
                  className="w-full p-2 border rounded-md"
                  placeholder="/path/to/folder"
                />
                <p className="text-xs text-gray-500 mt-1">Leave empty to generate automatically</p>
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1" htmlFor="color">Color</label>
                <select
                  id="color"
                  name="color"
                  className="w-full p-2 border rounded-md"
                >
                  <option value="#4F46E5">Blue</option>
                  <option value="#10B981">Green</option>
                  <option value="#F59E0B">Yellow</option>
                  <option value="#EF4444">Red</option>
                  <option value="#8B5CF6">Purple</option>
                  <option value="#EC4899">Pink</option>
                </select>
              </div>
              
              <div className="mb-4">
                <label className="flex items-center">
                  <input 
                    type="checkbox"
                    name="shared"
                    className="mr-2"
                  />
                  <span className="text-sm">Share this folder</span>
                </label>
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1" htmlFor="shareMode">Share Permission</label>
                <select 
                  id="shareMode"
                  name="shareMode"
                  className="w-full p-2 border rounded-md"
                >
                  <option value="read-only">Read Only</option>
                  <option value="read-write">Read & Write</option>
                </select>
              </div>
              
              <div className="mb-6">
                <label className="flex items-center">
                  <input 
                    type="checkbox"
                    name="encrypted"
                    defaultChecked={true}
                    className="mr-2"
                  />
                  <span className="text-sm">Encrypt data transfers</span>
                </label>
              </div>
              
              <div className="flex justify-end gap-2">
                <button 
                  type="button"
                  className="px-4 py-2 border rounded-md"
                  onClick={() => setNewFolderModal(false)}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-blue-500 text-white rounded-md"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Notification toast */}
      {notification.show && (
        <div className="fixed bottom-4 right-4 max-w-md">
          <div className={`rounded-md shadow-lg p-4 flex items-center gap-3 ${
            notification.type === 'success' ? 'bg-green-50 text-green-800 border-l-4 border-green-500' :
            notification.type === 'error' ? 'bg-red-50 text-red-800 border-l-4 border-red-500' :
            'bg-blue-50 text-blue-800 border-l-4 border-blue-500'
          }`}>
            {notification.type === 'success' && <Check size={20} />}
            {notification.type === 'error' && <span className="text-xl">⚠️</span>}
            {notification.type === 'info' && <span className="text-xl">ℹ️</span>}
            <p>{notification.message}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default BlockSyncApp;