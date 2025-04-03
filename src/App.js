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

   // Reference to track current connection cycle (must be outside useEffect)
const connectionCycleRef = useRef(Date.now());

// 1. MAIN CONNECTION SETUP - Only depends on user and device ID
useEffect(() => {
  if (!user) return;
  
  // Update connection cycle ID to ensure fresh connection
  connectionCycleRef.current = Date.now();
  const currentCycle = connectionCycleRef.current;
  
  // Initialize WebRTC peer connections
  const connectToPeerNetwork = async () => {
    try {
      // Connect to signaling server
      showNotification('Connecting to peer network...', 'info');
      const signalingServer = await connectToSignalingServer();
      
      // Check if this effect is still current (prevents stale connections)
      if (currentCycle !== connectionCycleRef.current) return;
      
      // Update UI with connection state
      setPeerNetworkState(prev => ({
        ...prev,
        connected: true,
        networkId: signalingServer.networkId
      }));
      
      // Announce our presence with initial folders
      signalingServer.announce({
        userId: user.uid,
        deviceId: activeDevice.id,
        folders: syncFolders.map(folder => ({
          id: folder.id,
          secretKey: folder.secretKey,
          shared: folder.shared
        }))
      });
      
      // Setup ping interval to keep connection alive
      const pingInterval = setInterval(() => {
        if (signalingServer && signalingServer.networkId) {
          signalingServer.ping && signalingServer.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 25000);
      
      // Peer joined event handler
      signalingServer.on('peer-joined', async (peerInfo) => {
        console.log(`🟢 Peer joined:`, peerInfo);
        
        // Get your socket ID for comparison
        const yourId = signalingServer.networkId;
        
        // Deterministic decision on who initiates based on socket ID
        const shouldInitiate = yourId.localeCompare(peerInfo.id) > 0;
        console.log(`Should initiate connection to ${peerInfo.id}? ${shouldInitiate}`);
        
        // Track connection state to prevent duplicate connections
        const peerConnectionState = {
          id: peerInfo.id,
          connectionAttemptTime: Date.now(),
          shouldInitiate
        };
        
        // Store the connection state for this peer
        if (!peers.current[peerInfo.id] || peers.current[peerInfo.id].status === 'error') {
          // Only create a new connection if we're the initiator and there isn't already a connection
          // OR if there's an existing connection in error state
          if (shouldInitiate) {
            console.log(`Creating connection to ${peerInfo.id} as initiator`);
            
            // Clean up any existing connection properly
            if (peers.current[peerInfo.id]) {
              await safeDestroyPeer(peerInfo.id);
              delete peers.current[peerInfo.id];
              
              // Give time for cleanup to complete
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // Create and store preliminary connection state before actual connection
            peers.current[peerInfo.id] = {
              status: 'connecting',
              peerId: peerInfo.id,
              isInitiator: true,
              ...peerConnectionState
            };
            
            // Create new connection
            try {
              const peerConnection = await createPeerConnection(peerInfo.id, true, signalingServer);
              
              // Update with full connection info only if our connecting state still matches
              // This prevents race conditions with simultaneous connection attempts
              if (peers.current[peerInfo.id] && peers.current[peerInfo.id].connectionAttemptTime === peerConnectionState.connectionAttemptTime) {
                peers.current[peerInfo.id] = {
                  ...peerConnection,
                  isInitiator: true,
                  ...peerConnectionState
                };
              }
            } catch (error) {
              console.error(`Error creating connection to ${peerInfo.id}:`, error);
              if (peers.current[peerInfo.id] && peers.current[peerInfo.id].connectionAttemptTime === peerConnectionState.connectionAttemptTime) {
                peers.current[peerInfo.id].status = 'error';
              }
            }
          } else {
            console.log(`Waiting for ${peerInfo.id} to initiate connection to us`);
            // Store state showing we're expecting an inbound connection
            peers.current[peerInfo.id] = {
              status: 'awaiting_offer',
              peerId: peerInfo.id,
              isInitiator: false,
              ...peerConnectionState
            };
          }
        } else {
          console.log(`Connection already exists or in progress for peer ${peerInfo.id}`);
        }
        
        // Check for common folders (keep this logic in both cases)
        const commonFolders = syncFolders.filter(folder => 
          peerInfo.folders.some(f => f.secretKey === folder.secretKey)
        );
        
        console.log(`Common folders with peer ${peerInfo.id}:`, commonFolders.length);
        
        if (commonFolders.length > 0) {
          // We have common folders with this peer, update folder device count
          commonFolders.forEach(folder => {
            // Update folder in state - MOVED TO SEPARATE EFFECT
            // Instead, dispatch a custom event that will be handled by a separate effect
            const folderUpdateEvent = new CustomEvent('folderPeerUpdate', {
              detail: { 
                folderId: folder.id, 
                peerId: peerInfo.id, 
                action: 'add' 
              }
            });
            window.dispatchEvent(folderUpdateEvent);
          });
        }
      });
      
      // Listen for peer disconnect events
      signalingServer.on('peer-left', (peerId) => {
        console.log(`🔴 Peer left:`, peerId);
        
        // Clean up peer connection
        if (peers.current[peerId]) {
          safeDestroyPeer(peerId);
          delete peers.current[peerId];
        }
        
        if (connectedPeers.current[peerId]) {
          delete connectedPeers.current[peerId];
        }
        
        // Update folders that had this peer - MOVED TO SEPARATE EFFECT
        // Dispatch a custom event for the peer left to update folders
        const peerLeftEvent = new CustomEvent('peerLeft', {
          detail: { peerId }
        });
        window.dispatchEvent(peerLeftEvent);
        
        // Update peer count
        setPeerNetworkState(prev => ({
          ...prev,
          peerCount: Object.keys(connectedPeers.current).length
        }));
      });
      
      // Signal event handler
      signalingServer.on('signal', async (data) => {
        const { from, signal } = data;
        
        console.log(`📥 Received signal from ${from}, type: ${signal.type || 'candidate'}`);
        
        try {
          const yourId = signalingServer.networkId;
          const shouldBeInitiator = yourId.localeCompare(from) > 0;
          
          // Get current peer state
          const peerState = peers.current[from];
          
          // CASE 1: We receive an offer and we're in awaiting_offer state (we're the receiver)
          if (signal.type === 'offer' && peerState && peerState.status === 'awaiting_offer' && !shouldBeInitiator) {
            console.log(`Received expected offer from ${from}, creating receiver connection`);
            
            try {
              // Create receiver connection
              const peerConnection = await createPeerConnection(from, false, signalingServer);
              
              // Store the connection and immediately process the offer
              peers.current[from] = {
                ...peerConnection,
                status: 'connecting',
                peerId: from,
                isInitiator: false,
                connectionAttemptTime: Date.now()
              };
              
              // Process the offer signal
              if (peerConnection.peer && !peerConnection.peer._destroyed) {
                peerConnection.peer.signal(signal);
              }
            } catch (error) {
              console.error(`Error creating receiver connection for ${from}:`, error);
              peers.current[from].status = 'error';
            }
            
            return;
          }
          
          // CASE 2: We receive an offer but we should be initiator (conflict)
          if (signal.type === 'offer' && shouldBeInitiator) {
            console.log(`Received unexpected offer from ${from} but we should be initiator`);
            
            // If we're already connected or connecting as initiator, ignore this offer
            if (peerState && (peerState.status === 'connected' || 
                (peerState.status === 'connecting' && peerState.isInitiator))) {
              console.log(`We're already connecting as initiator, ignoring offer`);
              return;
            }
            
            // If we don't have an active connection attempt or our attempt is older,
            // we'll defer to the peer's offer
            if (!peerState || 
                (peerState.connectionAttemptTime && 
                 Date.now() - peerState.connectionAttemptTime > 5000)) {
              
              console.log(`Accepting offer from ${from} despite being expected initiator`);
              
              // Clean up any existing connection
              if (peerState) {
                await safeDestroyPeer(from);
              }
              
              // Create new connection as receiver
              try {
                const peerConnection = await createPeerConnection(from, false, signalingServer);
                peers.current[from] = {
                  ...peerConnection,
                  status: 'connecting',
                  peerId: from,
                  isInitiator: false,
                  connectionAttemptTime: Date.now()
                };
                
                // Process the offer signal
                if (peerConnection.peer && !peerConnection.peer._destroyed) {
                  peerConnection.peer.signal(signal);
                }
              } catch (error) {
                console.error(`Error creating receiver connection for ${from}:`, error);
                if (peers.current[from]) peers.current[from].status = 'error';
              }
            }
            
            return;
          }
          
          // CASE 3: Process signals for existing peer connections
          if (peerState && peerState.peer) {
            // Only process signals if the peer is not destroyed
            if (!peerState.peer._destroyed) {
              console.log(`Processing ${signal.type || 'candidate'} signal for existing peer ${from}`);
              peerState.peer.signal(signal);
            } else {
              console.log(`Cannot process signal: Peer ${from} is destroyed`);
              // Remove destroyed peer from our records
              delete peers.current[from];
              
              // If this was a non-offer signal, we might need to create a new connection
              if (signal.type !== 'offer' && shouldBeInitiator) {
                console.log(`Initiating new connection to replace destroyed peer ${from}`);
                try {
                  const peerConnection = await createPeerConnection(from, true, signalingServer);
                  peers.current[from] = {
                    ...peerConnection,
                    status: 'connecting',
                    peerId: from,
                    isInitiator: true,
                    connectionAttemptTime: Date.now()
                  };
                } catch (error) {
                  console.error(`Error creating new initiator connection for ${from}:`, error);
                }
              }
            }
            
            return;
          }
          
          // CASE 4: No existing peer, but received a non-offer signal
          if (!peerState && signal.type !== 'offer') {
            console.log(`Received non-offer signal from unknown peer ${from}, ignoring`);
            return;
          }
          
          // CASE 5: No existing peer, received an offer, and we should be receiver
          if (!peerState && signal.type === 'offer' && !shouldBeInitiator) {
            console.log(`Creating new peer connection to ${from} as receiver from offer`);
            try {
              const peerConnection = await createPeerConnection(from, false, signalingServer);
              peers.current[from] = {
                ...peerConnection,
                status: 'connecting',
                peerId: from,
                isInitiator: false,
                connectionAttemptTime: Date.now()
              };
              
              // Process the offer signal
              if (peerConnection.peer && !peerConnection.peer._destroyed) {
                peerConnection.peer.signal(signal);
              }
            } catch (error) {
              console.error(`Error creating receiver connection for ${from}:`, error);
              if (peers.current[from]) peers.current[from].status = 'error';
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
    // Update connection cycle ref to invalidate any async operations
    connectionCycleRef.current = Date.now();
    
    console.log('Performing cleanup of WebRTC connections');
    
    // Disconnect from signaling server
    if (socket.current) {
      socket.current.disconnect();
      socket.current = null;
    }
    
    // Close all peer connections with proper cleanup
    const peerIds = Object.keys(peers.current);
    console.log(`Cleaning up ${peerIds.length} peer connections`);
    
    peerIds.forEach(peerId => {
      safeDestroyPeer(peerId);
    });
    
    // Clear all references
    peers.current = {};
    dataChannels.current = {};
    connectedPeers.current = {};
    
    // Clean up any pending requests
    const pendingRequestIds = Object.keys(pendingRequests.current);
    if (pendingRequestIds.length > 0) {
      console.log(`Cleaning up ${pendingRequestIds.length} pending requests`);
      pendingRequestIds.forEach(id => {
        const request = pendingRequests.current[id];
        if (request.reject) {
          request.reject(new Error('Component unmounting'));
        }
      });
      pendingRequests.current = {};
    }
    
    console.log('WebRTC cleanup completed');
  };
// Only depend on user and deviceId, not syncFolders
}, [user, activeDevice.id]); 


// 2. FOLDER UPDATES FROM PEERS - Listen for folder peer update events
useEffect(() => {
  // Function to handle folder peer updates
  const handleFolderPeerUpdate = (event) => {
    const { folderId, peerId, action } = event.detail;
    
    setSyncFolders(prev => prev.map(folder => {
      if (folder.id === folderId) {
        // For 'add' action, add the peer to the folder
        if (action === 'add') {
          const currentPeers = folder.peers || [];
          const updatedPeers = currentPeers.includes(peerId) ? 
            currentPeers : [...currentPeers, peerId];
            
          return {
            ...folder,
            devices: updatedPeers.length + 1, // +1 for our device
            peers: updatedPeers
          };
        } 
        // For 'remove' action, remove the peer from the folder
        else if (action === 'remove') {
          const updatedPeers = (folder.peers || []).filter(p => p !== peerId);
          
          return {
            ...folder,
            devices: Math.max(1, updatedPeers.length + 1), // Ensure at least 1 device (ours)
            peers: updatedPeers
          };
        }
      }
      return folder;
    }));
  };
  
  // Function to handle peer left events
  const handlePeerLeft = (event) => {
    const { peerId } = event.detail;
    
    setSyncFolders(prev => prev.map(folder => {
      if (folder.peers && folder.peers.includes(peerId)) {
        const updatedPeers = folder.peers.filter(p => p !== peerId);
        
        return {
          ...folder,
          devices: Math.max(1, updatedPeers.length + 1), // Ensure at least 1 device
          peers: updatedPeers
        };
      }
      return folder;
    }));
  };
  
  // Add event listeners
  window.addEventListener('folderPeerUpdate', handleFolderPeerUpdate);
  window.addEventListener('peerLeft', handlePeerLeft);
  
  // Cleanup
  return () => {
    window.removeEventListener('folderPeerUpdate', handleFolderPeerUpdate);
    window.removeEventListener('peerLeft', handlePeerLeft);
  };
}, []);


// 3. FOLDER ANNOUNCEMENT EFFECT - Announces folder changes without reconnecting
useEffect(() => {
  if (!socket.current || !user) return;
  
  // Announce updated folders to the network
  const announceFolders = () => {
    try {
      // Don't attempt if socket isn't connected
      if (!socket.current.networkId) {
        console.log('Socket not connected, skipping folder announcement');
        return;
      }
      
      console.log('Announcing folder updates to the network');
      socket.current.announce({
        userId: user.uid,
        deviceId: activeDevice.id,
        folders: syncFolders.map(folder => ({
          id: folder.id,
          secretKey: folder.secretKey,
          shared: folder.shared
        }))
      });
    } catch (err) {
      console.error('Error announcing folders:', err);
    }
  };

  // Set a small delay to prevent multiple rapid announcements
  const timeoutId = setTimeout(announceFolders, 300);
  
  return () => clearTimeout(timeoutId);
}, [syncFolders, user, activeDevice.id]);


// 4. ENHANCED SIGNALING SERVER CONNECTION
const connectToSignalingServer = async () => {
  return new Promise((resolve, reject) => {
    try {
      // Try to connect to the signaling server
      console.log(`Connecting to signaling server at ${SIGNALING_SERVER}`);
      
      const socketConnection = io(SIGNALING_SERVER, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 10, // Increased from 5
        reconnectionDelay: 2000, // Increased from 1000
        timeout: 20000, // Added longer timeout
        query: {
          userId: user.uid,
          deviceId: activeDevice.id
        }
      });
      
      // Track connection attempts for debugging
      let connectionAttempts = 0;
      
      // Set up event handlers
      socketConnection.on('connect', () => {
        console.log(`🟢 Connected to signaling server: ${socketConnection.id}`);
        connectionAttempts = 0; // Reset counter on successful connection
        
        // Create the signaling interface
        const signalingInterface = {
          announce: (data) => {
            console.log(`Announcing presence with folders:`, data.folders);
            if (socketConnection.connected) {
              socketConnection.emit('announce', data);
            } else {
              console.warn('Socket not connected, can\'t announce presence');
            }
          },
          on: (event, callback) => {
            socketConnection.on(event, callback);
          },
          send: (to, data) => {
            console.log(`Sending signal to ${to}, type: ${data.type || 'candidate'}`);
            if (socketConnection.connected) {
              socketConnection.emit('signal', { to, signal: data });
            } else {
              console.warn(`Socket not connected, can't send signal to ${to}`);
            }
          },
          networkId: socketConnection.id,
          ping: () => {
            if (socketConnection.connected) {
              socketConnection.emit('ping');
            }
          },
          disconnect: () => {
            // Clean up event listeners before disconnecting
            ['connect', 'connect_error', 'connect_timeout', 'announce', 'peer-joined', 'peer-left', 'signal'].forEach(event => {
              socketConnection.off(event);
            });
            socketConnection.disconnect();
          },
          // Add this to safely clean up event listeners
          removeAllListeners: () => {
            ['connect', 'connect_error', 'connect_timeout', 'announce', 'peer-joined', 'peer-left', 'signal'].forEach(event => {
              socketConnection.off(event);
            });
          }
        };
        
        resolve(signalingInterface);
      });
      
      socketConnection.on('connect_error', (err) => {
        console.error('Connection error:', err);
        connectionAttempts++;
        
        if (connectionAttempts >= 5) {
          console.error(`Failed to connect after ${connectionAttempts} attempts`);
          reject(err);
        }
      });
      
      socketConnection.on('connect_timeout', (err) => {
        console.error('Connection timeout:', err);
        connectionAttempts++;
        
        if (connectionAttempts >= 5) {
          console.error(`Connection timed out after ${connectionAttempts} attempts`);
          reject(new Error('Connection timeout'));
        }
      });
      
      // Add connection monitoring for debugging
      socketConnection.on('disconnect', (reason) => {
        console.error(`Signaling server disconnected: ${reason}`);
        // Don't try to reconnect if we intentionally disconnected
        if (reason === 'io client disconnect') {
          return;
        }
      });
      
      socketConnection.on('reconnect_attempt', (attemptNumber) => {
        console.log(`Attempting to reconnect to signaling server (attempt ${attemptNumber})`);
      });
      
      socketConnection.on('reconnect', (attemptNumber) => {
        console.log(`Reconnected to signaling server after ${attemptNumber} attempts`);
      });
      
      socketConnection.on('reconnect_error', (err) => {
        console.error('Reconnection error:', err);
      });
      
      socketConnection.on('reconnect_failed', () => {
        console.error('Failed to reconnect to signaling server');
        reject(new Error('Reconnection failed'));
      });
      
      // Add timeout for initial connection
      const connectionTimeout = setTimeout(() => {
        if (!socketConnection.connected) {
          console.error('Connection to signaling server timed out');
          socketConnection.close();
          reject(new Error('Connection timeout'));
        }
      }, 15000); // Increased from 10000
      
      // Clear timeout when connected
      socketConnection.on('connect', () => {
        clearTimeout(connectionTimeout);
      });
      
      // Handle pong from server to confirm active connection
      socketConnection.on('pong', () => {
        console.log('Received pong from server, connection still alive');
      });
      
    } catch (error) {
      console.error('Error connecting to signaling server:', error);
      reject(error);
    }
  });
};

const safeDestroyPeer = (peerId) => {
  try {
    const peer = peers.current[peerId];
    
    if (!peer) {
      console.log(`No peer object found for ${peerId}`);
      return;
    }
    
    console.log(`Attempting to safely destroy peer ${peerId}`);
    
    // First, clean up any message handlers
    if (peer.messageHandlers && typeof peer.messageHandlers.forEach === 'function') {
      console.log(`Cleaning up ${peer.messageHandlers.size} message handlers for peer ${peerId}`);
      peer.messageHandlers.forEach(handler => {
        if (handler.timeoutId) {
          clearTimeout(handler.timeoutId);
        }
      });
      peer.messageHandlers.clear();
    }
    
    // Clean up pending requests for this peer
    const pendingRequestIds = Object.keys(pendingRequests.current).filter(
      id => pendingRequests.current[id].peerId === peerId
    );
    
    if (pendingRequestIds.length > 0) {
      console.log(`Cleaning up ${pendingRequestIds.length} pending requests for peer ${peerId}`);
      pendingRequestIds.forEach(id => {
        const request = pendingRequests.current[id];
        if (request.handlerId) {
          // Since we're destroying the peer, we don't need to explicitly remove the handler
          request.reject(new Error('Peer connection closed'));
        }
        delete pendingRequests.current[id];
      });
    }
    
    // Clean up any ICE connection event listeners
    if (peer.peer && peer.peer._pc) {
      const pc = peer.peer._pc;
      
      // Use a safer approach that doesn't require us to know the exact listeners
      const eventTypes = [
        'connectionstatechange',
        'iceconnectionstatechange',
        'icegatheringstatechange',
        'negotiationneeded',
        'signalingstatechange',
        'track'
      ];
      
      eventTypes.forEach(eventType => {
        try {
          // Get a clone of the event listeners if possible
          const listeners = pc[`on${eventType}`] ? [pc[`on${eventType}`]] : [];
          
          // Replace with empty function
          pc[`on${eventType}`] = null;
          
          // Try to use removeEventListener for each, though this may not work for all browsers
          listeners.forEach(listener => {
            try {
              if (listener) pc.removeEventListener(eventType, listener);
            } catch (e) {
              // Ignore errors in cleanup
            }
          });
        } catch (e) {
          // Ignore errors in cleanup
        }
      });
    }
    
    // Now destroy the peer object with the most appropriate method
    if (typeof peer.destroy === 'function') {
      // If the peer wrapper has a destroy method (our standardized approach)
      console.log(`Using wrapper destroy() for peer ${peerId}`);
      peer.destroy();
    } else if (peer.peer && typeof peer.peer.destroy === 'function') {
      // If the peer has a nested peer object with destroy
      console.log(`Using peer.peer.destroy() for peer ${peerId}`);
      peer.peer.destroy();
    } else {
      // As a last resort
      console.log(`No standard destroy method found for peer ${peerId}`);
      
      // Try to close any data channels
      if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
        // Remove all data channel event listeners to prevent memory leaks
        if (typeof peer.dataChannel.removeEventListener === 'function') {
          try {
            ['message', 'open', 'close', 'error'].forEach(eventType => {
              // This removes all listeners but it's safe given we're destroying the peer
              peer.dataChannel.removeEventListener(eventType, null);
            });
          } catch (e) {
            // Ignore errors, just try to clean up
          }
        }
        
        console.log(`Closing data channel for peer ${peerId}`);
        peer.dataChannel.close();
      }
      
      if (peer.peer && peer.peer._pc) {
        try {
          peer.peer._pc.close();
        } catch (err) {
          console.error(`Error closing peer._pc`, err);
        }
        peer.peer._pc = null;
      }
    }
    
    // Remove the peer from our maps regardless of success
    delete peers.current[peerId];
    if (connectedPeers.current[peerId]) {
      delete connectedPeers.current[peerId];
    }
    
    console.log(`Peer ${peerId} removed from tracking maps`);
    return true;
  } catch (error) {
    console.error(`Error destroying peer ${peerId}:`, error);
    // Ensure we remove references even if an error occurs
    delete peers.current[peerId];
    if (connectedPeers.current[peerId]) {
      delete connectedPeers.current[peerId];
    }
    return false;
  }
};


const createPeerConnection = async (peerId, initiator, signalingServer) => {
  return new Promise((resolve, reject) => {
    try {
      console.log(`📡 Creating peer connection to ${peerId}, initiator: ${initiator}`);

      const peer = new SimplePeer({
        initiator,
        trickle: true,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });

      const preliminary = { 
        peer, 
        status: 'connecting', 
        peerId,
        messageHandlers: new Map() // Add map for custom message handlers
      };
      peers.current[peerId] = preliminary;

      peer.on('signal', data => {
        console.log(`📤 Sending signal to ${peerId}: ${data.type || 'candidate'}`);
        signalingServer.send(peerId, data);
      });

      peer.on('connect', () => {
        console.log(`Peer ${peerId} data channel established`);
        const dataChannel = peer._channel;
        dataChannel.peerId = peerId;

        // Add a small delay before considering the connection ready
        // This gives the data channel time to fully stabilize
        setTimeout(() => {
          console.log(`Creating peer wrapper for ${peerId} after connection stabilization`);
          
          const peerWrapper = {
            peer,
            dataChannel,
            status: 'connected',
            messageHandlers: new Map(), // Track message handlers
            peerId,
            isInitiator: initiator,
            connectionTime: Date.now(),
            
            // In createPeerConnection, update the peerWrapper.send method:
send: msg => {
  try {
    // Make extra sure we have a valid dataChannel
    if (!dataChannel) {
      console.warn(`Data channel is null for peer ${peerId}`);
      return false;
    }
    
    // Multiple readyState checks
    if (dataChannel.readyState !== 'open') {
      console.warn(`Data channel not open for peer ${peerId}. State: ${dataChannel.readyState}`);
      return false;
    }
    
    // Check the peer object isn't destroyed
    if (peer._destroyed) {
      console.warn(`Cannot send - peer ${peerId} is destroyed`);
      return false;
    }
    
    const jsonStr = JSON.stringify(msg);
    
    // One more check right before sending
    if (dataChannel.readyState === 'open') {
      dataChannel.send(jsonStr);
      return true;
    } else {
      console.warn(`Data channel state changed to ${dataChannel.readyState} before sending`);
      return false;
    }
  } catch (err) {
    console.error(`❌ Failed to send to ${peerId}`, err, err.stack);
    return false;
  }
},
            
            // Send binary data
            sendBinary: data => {
              try {
                if (!dataChannel || dataChannel.readyState !== 'open') {
                  console.warn(`Data channel not open for peer ${peerId}. State: ${dataChannel?.readyState || 'undefined'}`);
                  return false;
                }
                
                dataChannel.send(data);
                return true;
              } catch (err) {
                console.error(`❌ Failed to send binary data to ${peerId}`, err);
                return false;
              }
            },
            
            // Add a message handler for a specific type with optional timeout
            addMessageHandler: (messageType, handler, timeout = 30000) => {
              const handlerId = `${messageType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              
              const handlerInfo = {
                id: handlerId,
                type: messageType,
                handler,
                timestamp: Date.now()
              };
              
              // Set timeout to auto-remove handler if specified
              if (timeout > 0) {
                handlerInfo.timeoutId = setTimeout(() => {
                  if (peerWrapper.messageHandlers) {
                    peerWrapper.messageHandlers.delete(handlerId);
                    console.log(`🕒 Timed out and removed message handler ${handlerId} for ${messageType}`);
                  }
                }, timeout);
              }
              
              peerWrapper.messageHandlers.set(handlerId, handlerInfo);
              console.log(`➕ Added message handler ${handlerId} for ${messageType}`);
              return handlerId;
            },
            
            // Remove a specific message handler by ID
            removeMessageHandler: (handlerId) => {
              if (!peerWrapper.messageHandlers) return false;
              
              const handlerInfo = peerWrapper.messageHandlers.get(handlerId);
              if (handlerInfo) {
                if (handlerInfo.timeoutId) {
                  clearTimeout(handlerInfo.timeoutId);
                }
                peerWrapper.messageHandlers.delete(handlerId);
                console.log(`➖ Removed message handler ${handlerId}`);
                return true;
              }
              return false;
            },
            
            // Clear all message handlers
            clearMessageHandlers: () => {
              if (!peerWrapper.messageHandlers) return;
              
              peerWrapper.messageHandlers.forEach(handler => {
                if (handler.timeoutId) {
                  clearTimeout(handler.timeoutId);
                }
              });
              peerWrapper.messageHandlers.clear();
              console.log(`🧹 Cleared all message handlers for peer ${peerId}`);
            },
            
            destroy: (reason = "explicit destroy call") => {
              console.log(`Destroying peer ${peerId}, reason: ${reason}`);
              console.trace("Destroy call stack trace");
              
              // Clear all message handlers before destroying
              peerWrapper.clearMessageHandlers();
              
              // Make sure we don't have circular references
              if (peer && !peer._destroyed) {
                peer.destroy();
              }
              
              // Remove from tracking maps
              delete peers.current[peerId];
              delete connectedPeers.current[peerId];
              
              console.log(`Peer ${peerId} destroyed and removed from tracking`);
            },
            
            requestFile: (fileId, folderId, start, end) =>
              requestFileChunk(peerWrapper, fileId, start, end, folderId)
          };

          // Store the wrapper in our maps
          connectedPeers.current[peerId] = peerWrapper;
          peers.current[peerId] = peerWrapper;

          // Log peer tracking maps state
          console.log(`Peer tracking state after connection:`, {
            inPeersMap: !!peers.current[peerId],
            inConnectedPeers: !!connectedPeers.current[peerId],
            peersCount: Object.keys(peers.current).length,
            connectedCount: Object.keys(connectedPeers.current).length
          });

          setPeerNetworkState(prev => ({
            ...prev,
            connected: true,
            peerCount: Object.keys(connectedPeers.current).length
          }));

          console.log(`🔗 Connected to ${peerId}`);
          
          // Additional check before sending first message
          // if (dataChannel && dataChannel.readyState === 'open') {
          //   console.log(`Sending initial PING to ${peerId}`);
          //   peerWrapper.send({ type: 'PING', data: { timestamp: Date.now() } });
          // } else {
          //   console.warn(`Not sending initial PING - data channel not ready: ${dataChannel?.readyState || 'undefined'}`);
          // }

          peerWrapper.isReady = true;

          resolve(peerWrapper);
          console.log(`Peer connection setup completed for ${peerId}`);
        }, 100); // 100ms delay to ensure data channel is ready
      });

      peer.on('data', raw => {
        try {
          // Parse the data - handle both string and binary formats
          if (raw instanceof ArrayBuffer || raw instanceof Uint8Array) {
            // Instead of your existing try/catch blocks, use the direct binary handling
            // This simplifies the binary data handling
            const handled = handleBinaryData(raw, peerId);
            
            // Only if not handled as binary, try to parse as JSON
            if (!handled) {
              try {
                const text = new TextDecoder().decode(raw);
                const message = JSON.parse(text);
                console.log(`📩 Received message from ${peerId}, type: ${message.type}`);
                
                // Process the message through handlers or default handler
                const peerObj = peers.current[peerId];
                let handled = false;
                
                if (peerObj && peerObj.messageHandlers && peerObj.messageHandlers.size > 0) {
                  const handlers = Array.from(peerObj.messageHandlers.values());
                  
                  for (const handlerInfo of handlers) {
                    if (handlerInfo.type === message.type) {
                      try {
                        handled = handlerInfo.handler(message) || handled;
                        
                        if (handlerInfo.oneTime) {
                          peerObj.removeMessageHandler(handlerInfo.id);
                        }
                      } catch (err) {
                        console.error(`Error in message handler for ${message.type}:`, err);
                      }
                    }
                  }
                }
                
                if (!handled) {
                  handlePeerMessage(message, peerId);
                }
              } catch (err) {
                console.warn(`Error parsing binary data as text: ${err.message}`);
              }
            }
          } else if (typeof raw === 'string') {
            // Parse string as JSON
            try {
              const message = JSON.parse(raw);
              console.log(`📩 Received string message from ${peerId}, type: ${message.type}`);
              
              // Process with handlers or default handler
              const peerObj = peers.current[peerId];
              let handled = false;
              
              if (peerObj && peerObj.messageHandlers && peerObj.messageHandlers.size > 0) {
                const handlers = Array.from(peerObj.messageHandlers.values());
                
                for (const handlerInfo of handlers) {
                  if (handlerInfo.type === message.type) {
                    try {
                      handled = handlerInfo.handler(message) || handled;
                      
                      if (handlerInfo.oneTime) {
                        peerObj.removeMessageHandler(handlerInfo.id);
                      }
                    } catch (err) {
                      console.error(`Error in message handler for ${message.type}:`, err);
                    }
                  }
                }
              }
              
              if (!handled) {
                handlePeerMessage(message, peerId);
              }
            } catch (err) {
              console.error(`Failed to parse JSON message from ${peerId}:`, err);
            }
          } else {
            console.error(`Received unexpected data type from ${peerId}`);
          }
        } catch (err) {
          console.error(`❌ Failed to handle data from ${peerId}`, err);
        }
      });

      peer.on('error', err => {
        console.error(`❌ Peer error with ${peerId}:`, err);
        console.log(`Error stack:`, err.stack);
        
        // Update status in peer object
        if (peers.current[peerId]) {
          peers.current[peerId].status = 'error';
          
          // Clean up message handlers
          if (peers.current[peerId].messageHandlers) {
            peers.current[peerId].messageHandlers.forEach(handler => {
              if (handler.timeoutId) {
                clearTimeout(handler.timeoutId);
              }
            });
            peers.current[peerId].messageHandlers.clear();
          }
        }
        
        delete connectedPeers.current[peerId];
        
        setPeerNetworkState(prev => ({
          ...prev,
          peerCount: Object.keys(connectedPeers.current).length
        }));
        
        // Only attempt to reconnect if we're still online and connected to signaling server
        if (socket.current && socket.current.networkId) {
          // Use our improved reconnection logic
          reestablishPeerConnection(peerId, signalingServer).catch(reconnectError => {
            console.error(`Failed to reestablish connection after error:`, reconnectError);
          });
        } else {
          console.log(`Not attempting to reconnect to ${peerId} - no signaling connection`);
        }
      });

      peer.on('close', () => {
        console.log(`🔌 Peer closed: ${peerId}`);
        console.log(`Peer state at close:`, {
          inPeersMap: !!peers.current[peerId],
          inConnectedPeers: !!connectedPeers.current[peerId],
          hasMessageHandlers: !!(peers.current[peerId]?.messageHandlers),
          peerDestroyed: peer._destroyed || false,
          peerStatus: peers.current[peerId]?.status || 'unknown'
        });
        console.trace("Peer close stack trace");
        
        // Clean up message handlers
        if (peers.current[peerId] && peers.current[peerId].messageHandlers) {
          peers.current[peerId].messageHandlers.forEach(handler => {
            if (handler.timeoutId) {
              clearTimeout(handler.timeoutId);
            }
          });
          
          peers.current[peerId].messageHandlers.clear();
        }
        
        // Clean up references
        delete connectedPeers.current[peerId];
        delete peers.current[peerId];
        
        setPeerNetworkState(prev => ({
          ...prev,
          peerCount: Object.keys(connectedPeers.current).length
        }));
      });

      // Advanced connection state monitoring
      peer._pc?.addEventListener?.('connectionstatechange', () => {
        const state = peer._pc?.connectionState;
        console.log(`🌐 Peer ${peerId} connection state:`, state);
        
        // Log detailed connection state
        console.log(`Peer state detail at ${state}:`, {
          peerInMap: !!peers.current[peerId],
          peerInConnected: !!connectedPeers.current[peerId],
          hasDataChannel: !!(peer._channel),
          dataChannelState: peer._channel ? peer._channel.readyState : 'none',
          peerDestroyed: peer._destroyed || false,
          socketConnected: !!(socket.current?.networkId)
        });
      
        if (state === 'connected') {
          console.log(`🎉 WebRTC fully connected to ${peerId}`);
        }
      
        if (state === 'disconnected' || state === 'failed') {
          console.warn(`⚠️ Connection lost to ${peerId}, cleaning up`);
          console.trace("Connection loss stack trace");
          safeDestroyPeer(peerId, `connectionstate: ${state}`);
        }
      });

      peer._pc?.addEventListener?.('iceconnectionstatechange', () => {
        const state = peer._pc?.iceConnectionState;
        console.log(`🧊 ICE state for ${peerId}:`, state);
        
        if (state === 'connected' || state === 'completed') {
          console.log(`✅ ICE connected with peer ${peerId}`);
        }
      
        if (state === 'failed') {
          console.warn(`❌ ICE failed for ${peerId}, attempting reconnect`);
          console.trace("ICE failure stack trace");
          
          // Clean up properly before reconnection attempt
          safeDestroyPeer(peerId, `ICE failed state: ${state}`);
          
          // Now try to reconnect
          reestablishPeerConnection(peerId, signalingServer).catch(error => {
            console.error(`Error reestablishing connection:`, error);
          });
        }
      });

      // If not initiator, resolve with preliminary object
      if (!initiator) resolve(preliminary);
    } catch (error) {
      console.error('❌ Failed to create peer:', error);
      reject(error);
    }
  });
};
  
// Reestablish a peer connection with proper initiator logic and exponential backoff
const reestablishPeerConnection = async (peerId, signalingServer) => {
  try {
    // Get the current time to track when this reconnection attempt started
    const reconnectStartTime = Date.now();
    console.log(`🔄 Attempting to reestablish connection with peer ${peerId}`);
    
    // Check if peer exists already
    if (peers.current[peerId] && peers.current[peerId].status === 'connected') {
      console.log(`Peer ${peerId} is already connected, no need to reestablish`);
      return peers.current[peerId];
    }
    
    // Use our deterministic logic to decide who should be the initiator
    const yourId = signalingServer.networkId;
    const shouldBeInitiator = yourId.localeCompare(peerId) > 0;
    
    console.log(`Should be initiator for reconnection to ${peerId}? ${shouldBeInitiator}`);
    
    // If we should be initiator, attempt to create a new connection
    if (shouldBeInitiator) {
      // First, ensure any existing connection is properly cleaned up
      if (peers.current[peerId]) {
        console.log(`Cleaning up existing peer ${peerId} before reconnection`);
        await safeDestroyPeer(peerId);
        
        // Small delay to ensure cleanup is complete
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Create a preliminary connection state
      peers.current[peerId] = {
        status: 'reconnecting',
        peerId,
        isInitiator: true,
        connectionAttemptTime: reconnectStartTime,
        reconnectAttempts: (peers.current[peerId]?.reconnectAttempts || 0) + 1
      };
      
      // Calculate backoff time based on number of attempts (exponential backoff)
      const attempts = peers.current[peerId].reconnectAttempts;
      const backoffTime = Math.min(Math.pow(2, attempts - 1) * 1000, 10000); // Cap at 10 seconds
      
      if (backoffTime > 0) {
        console.log(`Using exponential backoff: waiting ${backoffTime}ms before reconnection attempt #${attempts}`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
        
        // Check if another reconnection has been started in the meantime
        if (peers.current[peerId]?.connectionAttemptTime !== reconnectStartTime) {
          console.log(`A newer reconnection attempt for ${peerId} has started, aborting this one`);
          return null;
        }
      }
      
      // Create a new peer connection as initiator
      console.log(`Creating new initiator connection to ${peerId} (attempt #${attempts})`);
      
      try {
        const peerConnection = await createPeerConnection(peerId, true, signalingServer);
        
        // Update our tracked peers if this is still the most recent attempt
        if (peers.current[peerId]?.connectionAttemptTime === reconnectStartTime) {
          peers.current[peerId] = {
            ...peerConnection,
            isInitiator: true,
            reconnectAttempts: attempts,
            connectionAttemptTime: reconnectStartTime
          };
          
          return peerConnection;
        } else {
          // A newer attempt has taken precedence, destroy this connection
          console.log(`A newer reconnection attempt for ${peerId} has taken precedence`);
          if (peerConnection.destroy) peerConnection.destroy();
          else if (peerConnection.peer && peerConnection.peer.destroy) peerConnection.peer.destroy();
          return null;
        }
      } catch (error) {
        console.error(`Failed to create new connection to ${peerId}:`, error);
        
        // Mark this connection attempt as failed
        if (peers.current[peerId]?.connectionAttemptTime === reconnectStartTime) {
          peers.current[peerId].status = 'error';
        }
        
        // Schedule another attempt, but only if we haven't exceeded maximum attempts
        if (attempts < 5) {
          console.log(`Scheduling another reconnection attempt for ${peerId}`);
          
          // Use setTimeout to avoid blocking
          setTimeout(() => {
            reestablishPeerConnection(peerId, signalingServer)
              .catch(err => console.error(`Subsequent reconnection attempt failed:`, err));
          }, backoffTime * 2);
        } else {
          console.log(`Maximum reconnection attempts (5) reached for peer ${peerId}`);
        }
        
        throw error;
      }
    } else {
      // If we should NOT be the initiator, set up a state to wait for the other peer to connect
      console.log(`Not initiator for ${peerId}, setting state to await connection`);
      
      // Clean up any existing error state connection
      if (peers.current[peerId] && peers.current[peerId].status === 'error') {
        await safeDestroyPeer(peerId);
      }
      
      // Set state to awaiting connection from the other peer
      peers.current[peerId] = {
        status: 'awaiting_offer',
        peerId,
        isInitiator: false,
        connectionAttemptTime: reconnectStartTime
      };
      
      // Return null since we're not creating the connection
      return null;
    }
  } catch (error) {
    console.error(`Failed to reestablish peer connection with ${peerId}:`, error);
    throw error;
  }
};
  
const handlePeerMessage = (message, peerId) => {
  console.log(`Handle message from peer ${peerId}, type: ${message.type}`);
  
  const { type, data } = message;
  
  const peer = connectedPeers.current[peerId];
  if (!peer) {
    console.log(`Cannot handle message from ${peerId}: peer not found in connectedPeers`);
    return;
  }
  
  switch (type) {
    case 'PING':
      console.log(`Received PING from peer ${peerId}, sending PONG`);
      // Add a small delay before responding to avoid race conditions
      setTimeout(() => {
        if (connectedPeers.current[peerId]) {
          const success = peer.send({
            type: 'PONG',
            data: { 
              timestamp: Date.now(),
              original: data.timestamp 
            }
          });
          
          if (!success) {
            console.warn(`Failed to send PONG to ${peerId}`);
          }
        }
      }, 50);
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
  
  const handleBinaryData = (data, peerId) => {
    console.log(`📦 Received binary data from peer ${peerId}, size: ${data.byteLength || 'unknown'} bytes`);
    
    // Find the corresponding pending request
    const pendingRequest = Object.values(pendingRequests.current).find(
      req => req.peerId === peerId && (req.status === 'pending' || req.status === 'waiting')
    );
    
    if (pendingRequest) {
      console.log(`Found matching pending request for binary data: ${pendingRequest.id}`);
      
      // Update the request
      pendingRequest.status = 'received';
      pendingRequest.data = data;
      
      // Clean up if there's a cleanup function
      if (typeof pendingRequest.cleanup === 'function') {
        pendingRequest.cleanup();
      } else {
        // Otherwise just remove the message handler
        const peerObj = peers.current[peerId];
        if (peerObj && peerObj.removeMessageHandler && pendingRequest.handlerId) {
          peerObj.removeMessageHandler(pendingRequest.handlerId);
        }
      }
      
      // Resolve the promise
      if (typeof pendingRequest.resolve === 'function') {
        pendingRequest.resolve(data);
      }
      return true;
    } else {
      console.log('Received unexpected binary data from peer:', peerId);
      return false;
    }
  };

  
// Enhanced file request handler function 
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
    
    // Special case for metadata-only requests (when chunkStart == 0 and chunkEnd == 0 or 1)
    if (chunkStart === 0 && (chunkEnd === 0 || chunkEnd === 1)) {
      console.log(`Metadata-only request for file ${fileId}`);
      
      try {
        // Fetch just enough to get the file size
        const response = await fetch(file.url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const totalSize = file.size || (await response.blob()).size;
        
        // For metadata requests, just send the file info
        sendPeerMessage(peerId, {
          type: 'FILE_RESPONSE',
          data: {
            requestId,
            fileId,
            folderId,
            fileName: file.name,
            fileType: file.type,
            totalSize,
            chunkSize,
            success: true
          }
        });
        return;
      } catch (error) {
        console.error('Error getting file metadata:', error);
        sendPeerMessage(peerId, {
          type: 'FILE_RESPONSE',
          data: {
            requestId,
            error: `Error getting file metadata: ${error.message}`
          }
        });
        return;
      }
    }
    
    // Fetch the file data
    try {
      const response = await fetch(file.url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const fileData = await response.arrayBuffer();
      console.log(`Got file data, size: ${fileData.byteLength} bytes`);
      
      // Make sure the requested chunk is within bounds
      if (chunkStart >= fileData.byteLength) {
        throw new Error('Requested chunk start is beyond file size');
      }
      
      // Get the requested chunk
      const adjustedChunkEnd = Math.min(chunkEnd, fileData.byteLength);
      const chunk = fileData.slice(chunkStart, adjustedChunkEnd);
      console.log(`Sending chunk from ${chunkStart} to ${adjustedChunkEnd}, size: ${chunk.byteLength} bytes`);
      
      // Send response with chunk metadata
      sendPeerMessage(peerId, {
        type: 'FILE_RESPONSE',
        data: {
          requestId,
          fileId,
          folderId,
          chunkStart,
          chunkEnd: adjustedChunkEnd,
          totalSize: fileData.byteLength,
          chunkSize: chunk.byteLength,
          success: true
        }
      });
      
      // Wait a small amount of time to ensure the FILE_RESPONSE is processed first
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Send the binary data directly
      const peer = connectedPeers.current[peerId];
      if (peer && peer.sendBinary) {
        // Use our enhanced sendBinary method
        console.log(`Sending binary chunk using sendBinary, size: ${chunk.byteLength} bytes`);
        peer.sendBinary(new Uint8Array(chunk));
      } else if (peer && peer.dataChannel && peer.dataChannel.readyState === 'open') {
        // Fallback to direct data channel send
        console.log(`Sending binary chunk using dataChannel.send, size: ${chunk.byteLength} bytes`);
        peer.dataChannel.send(new Uint8Array(chunk));
      } else {
        console.error(`Unable to send binary data to peer ${peerId}`);
        sendPeerMessage(peerId, {
          type: 'FILE_RESPONSE',
          data: {
            requestId,
            error: 'Failed to send binary data'
          }
        });
      }
    } catch (error) {
      console.error(`Error fetching file data:`, error);
      sendPeerMessage(peerId, {
        type: 'FILE_RESPONSE',
        data: {
          requestId,
          error: `Error fetching file data: ${error.message}`
        }
      });
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

// 1. Add this new function to automatically sync files in the background
const syncFilesInBackground = async (folder) => {
  if (!folder || !folder.files || folder.files.length === 0) return;
  
  console.log(`Starting background sync for folder: ${folder.name}`);
  
  // Get all files that need syncing (not already synced)
  const filesToSync = folder.files.filter(file => !file.synced && !file.url);
  
  if (filesToSync.length === 0) {
    console.log(`All files in folder ${folder.name} are already synced`);
    return;
  }
  
  console.log(`Found ${filesToSync.length} files to sync in folder ${folder.name}`);
  
  // Get all connected peers
  const connectedPeerIds = Object.keys(connectedPeers.current);
  if (connectedPeerIds.length === 0) {
    console.log('No connected peers available for background sync');
    return;
  }
  
  // Process files one by one to avoid overwhelming the connection
  for (const file of filesToSync) {
    try {
      // Skip if already being downloaded or already synced
      if (downloadProgress[file.id]?.status === 'downloading' || file.synced) {
        continue;
      }
      
      console.log(`Background syncing file: ${file.name}`);
      
      // Create a downloadable file with the available peer
      const downloadableFile = {
        ...file,
        availableFrom: [connectedPeerIds[0]] // Use first connected peer
      };
      
      // Download the file in background
      await downloadFileFromPeers(downloadableFile, folder);
      
      // Short pause between files
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`Error syncing file ${file.name} in background:`, error);
      // Continue with next file on error
    }
  }
  
  console.log(`Background sync completed for folder: ${folder.name}`);
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
      
      // If the file is not synced, consider syncing it in the background
      const fileToSync = folder.files.find(f => f.id === fileId && !f.synced);
      if (fileToSync && Object.keys(downloadProgress).filter(id => 
        downloadProgress[id].status === 'downloading').length < 2) {  // Limit concurrent background downloads
        
        // Start background sync for this file 
        const downloadableFile = {
          ...fileToSync,
          availableFrom: [peerId]
        };
        
        // Use timeout to avoid immediate download and allow UI to update
        setTimeout(() => {
          downloadFileFromPeers(downloadableFile, folder)
            .catch(err => console.error(`Background sync failed for ${fileToSync.name}:`, err));
        }, 2000);
      }
    }
  };
  
// Send a message to a specific peer
const sendPeerMessage = (peerId, message) => {
  const peer = connectedPeers.current[peerId];
  if (!peer) {
    console.error(`❌ Unable to send message to peer: ${peerId} - No peer connection`);
    return false;
  }
  
  if (!peer.dataChannel) {
    console.error(`❌ Unable to send message to peer: ${peerId} - No data channel`);
    return false;
  }
  
  if (peer.dataChannel.readyState !== 'open') {
    console.error(`❌ Data channel not open for peer ${peerId}. State: ${peer.dataChannel.readyState}`);
    return false;
  }
  
  try {
    console.log(`📤 Sending message to peer ${peerId}:`, message.type);
    
    // Use the safer send method
    if (peer.send) {
      return peer.send(message);
    } else {
      // Fallback to direct dataChannel send
      peer.dataChannel.send(JSON.stringify(message));
      return true;
    }
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
  
  const requestFileChunk = async (peerWrapper, fileId, chunkStart, chunkEnd, folderId) => {
    console.log(`Requesting file chunk from peer ${peerWrapper.peerId}: file=${fileId}, folder=${folderId}, range=${chunkStart}-${chunkEnd}`);
    
    return new Promise((resolve, reject) => {
      // Generate a unique request ID
      const requestId = 'req_' + Math.random().toString(36).substr(2, 9);
      let handlerId = null;
      let binaryDataTimeout = null;
      
      // Function to cleanup resources
      const cleanup = () => {
        if (peerWrapper && peerWrapper.removeMessageHandler && handlerId) {
          peerWrapper.removeMessageHandler(handlerId);
        }
        if (binaryDataTimeout) {
          clearTimeout(binaryDataTimeout);
        }
        delete pendingRequests.current[requestId];
      };
      
      // Send the request
      try {
        // Add a handler for the FILE_RESPONSE message
        handlerId = peerWrapper.addMessageHandler('FILE_RESPONSE', (message) => {
          if (message.data && message.data.requestId === requestId) {
            const { error, success } = message.data;
            
            if (error) {
              // The request failed
              cleanup();
              reject(new Error(error));
              return true; // Mark as handled
            } else if (success) {
              console.log(`Received FILE_RESPONSE success for ${requestId}, awaiting binary chunk`);
              
              // Update the request status to waiting for binary data
              if (pendingRequests.current[requestId]) {
                pendingRequests.current[requestId].status = 'waiting';
              }
              
              // Set a timeout for receiving the binary data
              binaryDataTimeout = setTimeout(() => {
                console.error(`Timeout waiting for binary data for request ${requestId}`);
                cleanup();
                reject(new Error('Timeout waiting for binary data'));
              }, 20000); // 20 second timeout
              
              return true; // Mark as handled
            }
          }
          return false; // Not handled
        }, 40000); // 40 second timeout (longer than the binary data timeout)
        
        // Store this request so we can match binary data to it
        pendingRequests.current[requestId] = {
          id: requestId,
          fileId,
          folderId,
          chunkStart,
          chunkEnd,
          status: 'pending',
          createdAt: new Date(),
          peerId: peerWrapper.peerId,
          resolve,
          reject,
          handlerId,
          cleanup
        };
        
        // Send the request message
        const success = peerWrapper.send({
          type: 'FILE_REQUEST',
          data: {
            requestId,
            fileId,
            folderId,
            chunkStart,
            chunkEnd
          }
        });
        
        if (!success) {
          throw new Error('Failed to send request to peer');
        }
        
        console.log(`File chunk request sent to peer ${peerWrapper.peerId}`);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  };
  

  
// Enhanced downloadFileFromPeers with better binary handling
const downloadFileFromPeers = async (file, folder) => {
  console.log(`Starting downloadFileFromPeers for file:`, file.name);
  
  // Check if the file is already available locally
  if (file.synced && file.url) {
    console.log(`File already available locally, returning`);
    return file;
  }
  
  // Check if we have connected peers
  const connectedPeerIds = Object.keys(connectedPeers.current);
  if (connectedPeerIds.length === 0) {
    console.error('No connected peers available');
    throw new Error('No connected peers available');
  }
  
  // Determine which peer to use
  let peerId;
  
  // First check if any of the availableFrom peers are actually connected
  if (file.availableFrom && file.availableFrom.length > 0) {
    const availablePeer = file.availableFrom.find(id => connectedPeers.current[id]);
    if (availablePeer) {
      peerId = availablePeer;
      console.log(`Using specified peer ${peerId} from availableFrom list`);
    } else {
      console.log(`None of the specified peers are connected, using first available peer`);
      peerId = connectedPeerIds[0];
    }
  } else {
    // If no specific peers are listed, use the first connected peer
    peerId = connectedPeerIds[0];
    console.log(`No specific peers listed, using first available peer: ${peerId}`);
  }
  
  const peer = connectedPeers.current[peerId];
  if (!peer) {
    console.error(`Peer connection not available for ${peerId}`);
    throw new Error('Peer connection not available');
  }
  
  console.log(`Using peer ${peerId} to download file ${file.name} from folder ${folder.id}`);
  
  // Start the download process
  try {
    // Show progress in UI
    setDownloadProgress({
      fileId: file.id,
      progress: 0,
      status: 'starting'
    });
    
    // Enhanced debugging for the peer connection
    console.log(`Peer connection status:`, {
      peerId,
      status: peer.status,
      dataChannelState: peer.dataChannel ? peer.dataChannel.readyState : 'none',
      isReady: peer.isReady || false
    });
    
    // Wait for the peer to be fully ready before proceeding
    if (!peer.isReady) {
      console.log(`Waiting for peer connection to be fully ready...`);
      await new Promise((resolve) => {
        // Wait for up to 3 seconds for the connection to stabilize
        const maxWait = 3000;
        const startTime = Date.now();
        
        const checkReady = () => {
          if (peer.isReady) {
            resolve();
          } else if (Date.now() - startTime > maxWait) {
            resolve(); // Proceed anyway after timeout
          } else {
            setTimeout(checkReady, 100);
          }
        };
        
        checkReady();
      });
    }
    
    console.log(`Requesting file metadata for ${file.id} from folder ${folder.id}`);
    
    // First, try to fetch just the first byte to get metadata
    let fileSize;
    try {
      // Request just 1 byte to get the file metadata
      console.log("Requesting metadata chunk");
      const metadataResponse = await peer.requestFile(file.id, folder.id, 0, 1);
      console.log(`Got metadata response:`, metadataResponse);
      fileSize = metadataResponse.totalSize || file.size || 0;
    } catch (err) {
      console.warn(`Failed to get metadata via requestFile, using file.size: ${err.message}`);
      fileSize = file.size || 2048000; // Default to 2MB if no size available
    }
    
    if (!fileSize || fileSize <= 0) {
      console.warn(`Invalid file size (${fileSize}), using default size`);
      fileSize = 2048000; // Default to 2MB
    }
    
    console.log(`Determined file size: ${fileSize} bytes`);
    
    // Calculate chunks
    const chunks = Math.ceil(fileSize / chunkSize);
    
    console.log(`Downloading file ${file.name} (${formatFileSize(fileSize)}) in ${chunks} chunks`);
    
    // Initialize array buffer to store the full file
    const fileData = new Uint8Array(fileSize);
    
    // Track which chunks have been downloaded to prevent duplicates
    const downloadedChunks = new Set();
    
    // Download the chunks
    let downloaded = 0;
    
    // Process chunks one by one to ensure reliability
    for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
      if (downloadedChunks.has(chunkIndex)) {
        console.log(`Skipping already downloaded chunk ${chunkIndex+1}/${chunks}`);
        continue;
      }
      
      const chunkStart = chunkIndex * chunkSize;
      const chunkEnd = Math.min(chunkStart + chunkSize, fileSize);
      
      console.log(`Requesting chunk ${chunkIndex+1}/${chunks} (${chunkStart}-${chunkEnd})`);
      
      try {
        // Try up to 3 times for each chunk
        let chunkData = null;
        let attempts = 0;
        
        while (!chunkData && attempts < 3) {
          attempts++;
          try {
            chunkData = await peer.requestFile(file.id, folder.id, chunkStart, chunkEnd);
          } catch (err) {
            console.warn(`Attempt ${attempts}/3 failed for chunk ${chunkIndex+1}: ${err.message}`);
            // If not the last attempt, wait before retrying
            if (attempts < 3) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
              throw err; // Re-throw on last attempt
            }
          }
        }
        
        // Ensure we received binary data
        if (!(chunkData instanceof ArrayBuffer) && !(chunkData instanceof Uint8Array)) {
          throw new Error(`Received non-binary data for chunk ${chunkIndex}`);
        }
        
        // Convert to Uint8Array if needed
        const chunkUint8 = chunkData instanceof ArrayBuffer ? 
          new Uint8Array(chunkData) : chunkData;
        
        console.log(`Received chunk ${chunkIndex+1} successfully, size: ${chunkUint8.byteLength} bytes`);
        
        // Store the chunk at the correct position in the full file data
        fileData.set(chunkUint8, chunkStart);
        downloadedChunks.add(chunkIndex);
        
        downloaded += chunkUint8.byteLength;
        
        // Update progress
        setDownloadProgress({
          fileId: file.id,
          progress: Math.round((downloaded / fileSize) * 100),
          status: 'downloading'
        });
      } catch (error) {
        console.error(`Error downloading chunk ${chunkIndex}:`, error);
        throw new Error(`Error downloading chunk ${chunkIndex+1}/${chunks}: ${error.message}`);
      }
      
      // Brief pause between chunks to prevent overwhelming the connection
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`Download complete for ${file.name}, creating blob`);
    
    // Determine the correct MIME type
    const fileExtension = file.name.split('.').pop().toLowerCase();
    
    // Specific handling for different file types
    let mimeType;
    
    // Special case for images
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(fileExtension)) {
      mimeType = 'image/' + (fileExtension === 'jpg' ? 'jpeg' : fileExtension);
    } 
    // Special case for documents
    else if (['pdf'].includes(fileExtension)) {
      mimeType = 'application/pdf';
    }
    else if (['doc', 'docx'].includes(fileExtension)) {
      mimeType = fileExtension === 'doc' ? 'application/msword' : 
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    // Default case
    else {
      mimeType = getMimeTypeFromFileName(file.name) || 'application/octet-stream';
    }
    
    console.log(`Using MIME type: ${mimeType} for file ${file.name}`);
    
    // Create a blob from the file data
    const blob = new Blob([fileData], { type: mimeType });
    const fileUrl = URL.createObjectURL(blob);
    
    // Update file in state
    const updatedFile = {
      ...file,
      url: fileUrl,
      synced: true,
      size: fileSize
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
        size: fileSize,
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
    
    console.log(`File ${file.name} downloaded successfully`);
    
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
    const pendingRequests = [];
    
    // Set a timeout to resolve with whatever we've got
    const timeoutId = setTimeout(() => {
      // Clean up all handlers
      pendingRequests.forEach(({ peerId, handlerId }) => {
        const peer = connectedPeers.current[peerId];
        if (peer && peer.removeMessageHandler) {
          peer.removeMessageHandler(handlerId);
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
    
    // Send request to each connected peer
    for (const peerId of connectedPeerIds) {
      const peer = connectedPeers.current[peerId];
      if (!peer || peer.status !== 'connected') {
        console.log(`❌ Peer ${peerId} not available or not connected`);
        continue;
      }
      
      try {
        console.log(`📤 Sending folder request to peer ${peerId} for key ${secretKey}`);
        
        // Add a handler for the FOLDER_RESPONSE message
        const handlerId = peer.addMessageHandler('FOLDER_RESPONSE', (message) => {
          if (message.data && message.data.requestId === requestId) {
            console.log(`✅ Got folder response from peer ${peerId}:`, 
                      message.data.folderInfo ? 'Found folder' : 'No folder found');
            
            // Remove this handler
            peer.removeMessageHandler(handlerId);
            
            // Remove from pending requests
            const index = pendingRequests.findIndex(req => req.handlerId === handlerId);
            if (index !== -1) {
              pendingRequests.splice(index, 1);
            }
            
            // Store the response if folder was found
            if (message.data.folderInfo) {
              respondingPeers.push({
                peerId,
                folderInfo: message.data.folderInfo
              });
              
              // Immediately resolve and clear timeout if we found the folder
              clearTimeout(timeoutId);
              
              // Clean up any remaining handlers
              pendingRequests.forEach(({ peerId, handlerId }) => {
                const peer = connectedPeers.current[peerId];
                if (peer && peer.removeMessageHandler) {
                  peer.removeMessageHandler(handlerId);
                }
              });
              
              resolve(respondingPeers[0]);
            }
            
            return true; // Mark as handled
          }
          return false; // Not handled
        }, 12000); // Slightly longer than our overall timeout
        
        // Track this request for cleanup
        pendingRequests.push({ peerId, handlerId });
        
        // Send the request
        peer.send({
          type: 'FOLDER_REQUEST',
          data: {
            secretKey,
            requestId
          }
        });
      } catch (err) {
        console.error(`Error sending folder request to peer ${peerId}:`, err);
      }
    }
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
  
  // Use our standardized function to request the folder from peers
  const peerResponse = await requestFolderFromPeers(secretKey);
  
  if (peerResponse) {
    const { peerId, folderInfo } = peerResponse;
    console.log(`Using folder info from peer ${peerId}:`, folderInfo);
    const newFolder = addFolderFromPeer(folderInfo, peerId);
    if (newFolder) {
      showNotification(`Added shared folder: ${newFolder.name}`, 'success');
      return newFolder;
    }
  } else {
    console.log('No peers responded with folder info');
    showNotification('Could not find shared folder with that key', 'error');
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
  
// 3. Update the downloadFile function to be instant when files are already synced
const downloadFile = (file) => {
  console.log(`Attempting to download file:`, file);
  
  if (file.url) {
    try {
      // File is already synced, download instantly
      console.log(`File has URL, downloading directly: ${file.name}`);
      const a = document.createElement('a');
      a.href = file.url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      showNotification(`File "${file.name}" downloaded`, 'success');
    } catch (err) {
      console.error(`Error downloading local file:`, err);
      showNotification(`Error downloading file: ${err.message}`, 'error');
    }
  } 
  // If file is being downloaded in the background
  else if (downloadProgress[file.id]?.status === 'downloading') {
    showNotification(`File "${file.name}" is currently syncing (${downloadProgress[file.id].progress}%). Please wait...`, 'info');
  }
  // If file needs to be downloaded now
  else {
    // Get all connected peers
    const connectedPeerIds = Object.keys(connectedPeers.current);
    
    if (connectedPeerIds.length === 0) {
      showNotification('No peers available to download file', 'error');
      return;
    }
    
    // Use the first connected peer
    const peerId = connectedPeerIds[0];
    showNotification(`Downloading file "${file.name}" from peers...`, 'info');
    
    // Create a modified file object with the available peer
    const downloadableFile = {
      ...file,
      availableFrom: [peerId]
    };
    
    // Start the download process
    downloadFileFromPeers(downloadableFile, currentFolder)
      .then(downloadedFile => {
        console.log(`File downloaded successfully:`, downloadedFile);
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
          
          // Start background syncing if folder has peers
          if (folder.peers && folder.peers.length > 0 && 
              folder.files.some(file => !file.synced && !file.url)) {
            // Use setTimeout to not block the UI rendering
            setTimeout(() => {
              syncFilesInBackground(folder);
            }, 500);
          }
        } else {
          setFolderFiles([]);
        }
      } else {
        // If selected folder no longer exists
        setCurrentFolder(null);
        setFolderFiles([]);
      }
    }
  }, [currentFolder, syncFolders])
  
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
  
// If authentication is loading, show a loading screen
if (isAuthLoading) {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-900">
      <div className="text-center">
        <RefreshCw className="animate-spin h-12 w-12 text-[#A7236F] mx-auto mb-4" />
        <h1 className="text-xl font-semibold text-white">Loading BlockSync...</h1>
      </div>
    </div>
  );
}

// If user is not logged in, show the login screen
if (!user) {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-900">
      <div className="bg-gray-800 p-8 rounded-lg shadow-lg max-w-md w-full border border-gray-700">
        <div className="text-center mb-8">
          <RefreshCw className="h-12 w-12 text-[#A7236F] mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white">BlockSync</h1>
          <p className="text-gray-300 mt-2">Secure P2P file sharing with blockchain metadata</p>
        </div>
        <button
          className="w-full bg-[#A7236F] hover:bg-[#8A1D5B] text-white font-medium py-3 px-4 rounded-lg flex items-center justify-center gap-2"
          onClick={signInWithGoogle}
        >
          <User size={20} />
          Sign in to continue
        </button>
        <p className="text-center text-sm text-gray-400 mt-6">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
  
  // Main application UI when user is logged in
return (
  <div className="flex flex-col w-full h-screen bg-gray-900 text-white">
    {/* Header */}
    {/* Header */}
<header className="p-4 bg-[#A7236F] shadow-sm border-b">
  <div className="container mx-auto flex justify-between items-center">
    <h1 className="text-2xl font-semibold flex items-center gap-2">
      <RefreshCw className="text-white" />
      BlockSync
    </h1>
    
    <div className="flex items-center gap-4">
      {/* P2P Network Status */}
      <div className="text-sm flex items-center gap-2 bg-[#8A1D5B] p-1 px-2 rounded-full">
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
        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-[#A7236F]">
          {user && user.photoURL ? (
            <img src={user.photoURL} alt={user.displayName || 'User'} className="w-full h-full rounded-full" />
          ) : (
            <User size={18} />
          )}
        </div>
        <div className="text-sm">
          <p className="font-medium">{user ? user.displayName : 'User'}</p>
          <p className="text-xs text-gray-300">{user ? user.email : ''}</p>
        </div>
      </div>
      
      {/* Settings and logout */}
      <div className="flex items-center gap-2">
        <button className="p-2 rounded-full text-gray-300 hover:bg-[#8A1D5B]">
          <Settings size={20} />
        </button>
        <button 
          className="p-2 rounded-full text-gray-300 hover:bg-[#8A1D5B]"
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
      <div className="w-64 bg-gray-800 border-r border-gray-700 overflow-y-auto p-4">
        {/* Tabs */}
        <div className="flex border-b border-gray-700 mb-4">
          <button 
            className={`flex-1 pb-2 font-medium text-sm ${activeTab === 'folders' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-gray-400'}`}
            onClick={() => setActiveTab('folders')}
          >
            Folders
          </button>
          <button 
            className={`flex-1 pb-2 font-medium text-sm ${activeTab === 'devices' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-gray-400'}`}
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
                className="flex-1 bg-teal-600 text-white rounded-md p-2 text-sm font-medium flex items-center justify-center gap-1"
                onClick={() => setNewFolderModal(true)}
              >
                <Plus size={16} />
                Add Folder
              </button>
              <button 
                className="flex-1 bg-gray-700 text-gray-200 rounded-md p-2 text-sm font-medium flex items-center justify-center gap-1"
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
                <div className="text-center py-6 text-gray-400">
                  <p>No folders yet</p>
                  <p className="text-sm">Create a new folder to get started</p>
                </div>
              ) : (
                syncFolders.map(folder => (
                  <div 
                    key={folder.id} 
                    className={`p-3 rounded-lg cursor-pointer ${currentFolder && currentFolder.id === folder.id ? 'bg-gray-700 border border-gray-600' : 'hover:bg-gray-700'}`}
                    onClick={() => setCurrentFolder(folder)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-md flex items-center justify-center text-white`} style={{ backgroundColor: folder.color }}>
                        <FolderOpen size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm truncate">{folder.name}</h3>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <span>{formatFileSize(folder.size)}</span>
                          <span>•</span>
                          <div className="flex items-center gap-1">
                            <div className={`w-2 h-2 rounded-full ${getSyncStatusColor(folder)}`}></div>
                            {folder.syncEnabled ? 'Synced' : 'Paused'}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end text-xs text-gray-400">
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
              <h3 className="font-medium text-sm text-gray-300">Connected Devices</h3>
              <button className="text-teal-400 hover:text-teal-300 text-sm">
                <RefreshCw size={14} />
              </button>
            </div>
            
            {/* My device */}
            <div className="p-3 bg-gray-700 rounded-lg border border-gray-600">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md bg-teal-600 flex items-center justify-center text-white">
                  <HardDrive size={18} />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-sm">{activeDevice.name} (This device)</h3>
                  <p className="text-xs text-gray-400">ID: {truncateHash(activeDevice.id)}</p>
                </div>
                <div className="flex items-center gap-1 text-xs bg-green-900 text-green-400 px-2 py-1 rounded">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span>Online</span>
                </div>
              </div>
            </div>
            
            {/* Connected peer devices */}
            {Object.keys(connectedPeers.current).map(peerId => (
              <div key={peerId} className="p-3 bg-gray-700 rounded-lg border border-gray-600">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-orange-500 flex items-center justify-center text-white">
                    <HardDrive size={18} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-sm">Peer Device</h3>
                    <p className="text-xs text-gray-400">ID: {truncateHash(peerId)}</p>
                  </div>
                  <div className="flex items-center gap-1 text-xs bg-green-900 text-green-400 px-2 py-1 rounded">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span>Connected</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Main content */}
      <div className="flex-1 overflow-y-auto bg-gray-900">
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
                  <p className="text-sm text-gray-400">
                    {formatFileSize(currentFolder.size)} • {currentFolder.devices} device{currentFolder.devices !== 1 ? 's' : ''}
                    <span className="ml-2 text-xs text-gray-500">Last modified: {formatRelativeDate(currentFolder.modified)}</span>
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <button 
                  className={`p-2 rounded-md ${currentFolder.syncEnabled ? 'bg-teal-900 text-teal-400' : 'bg-gray-700 text-gray-400'}`}
                  onClick={() => toggleFolderSync(currentFolder.id)}
                >
                  <RefreshCw size={18} />
                </button>
                <button 
                  className="p-2 rounded-md bg-teal-900 text-teal-400"
                  onClick={() => shareFolder(currentFolder)}
                >
                  <Share2 size={18} />
                </button>
                <button 
                  className="p-2 rounded-md bg-red-900 text-red-400"
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
                <div className="bg-gray-800 shadow-sm rounded-lg p-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-medium text-gray-200">Upload Files</h3>
                    <button 
                      className="text-gray-400 hover:text-gray-200"
                      onClick={() => setUploadFormVisible(false)}
                    >
                      &times;
                    </button>
                  </div>
                  
                  <div className="mb-4">
                    <div className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center relative">
                      {selectedFiles.length > 0 ? (
                        <div>
                          <p className="font-medium text-gray-200">Selected Files:</p>
                          <ul className="text-sm text-gray-400 mt-2">
                            {selectedFiles.map((file, index) => (
                              <li key={index}>{file.name} ({formatFileSize(file.size)})</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          <Upload size={32} className="text-gray-500 mb-2" />
                          <p className="text-gray-400">Drag and drop files or click to browse</p>
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
                    className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-200 font-medium rounded-lg p-3 flex items-center justify-center gap-2"
                    onClick={() => setUploadFormVisible(true)}
                  >
                    <Upload size={18} />
                    Upload Files
                  </button>
                  
                  <button 
                    className="flex-1 bg-teal-900 hover:bg-teal-800 text-teal-300 font-medium rounded-lg p-3 flex items-center justify-center gap-2"
                    onClick={() => addDefaultFilesToFolder(currentFolder.id)}
                  >
                    <Plus size={18} />
                    Add Sample Files
                  </button>
                </div>
              )}
            </div>
            
            {/* Files */}
            <div className="bg-gray-800 shadow-sm rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700">
                <h3 className="font-medium text-gray-200">Files</h3>
              </div>
              
              {folderFiles.length > 0 ? (
                <table className="w-full">
                  <thead className="bg-gray-900 text-xs text-gray-400 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Name</th>
                      <th className="px-4 py-2 text-left font-medium">Size</th>
                      <th className="px-4 py-2 text-left font-medium">Modified</th>
                      <th className="px-4 py-2 text-left font-medium">Version</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                      <th className="px-4 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {folderFiles.map(file => (
                      <tr key={file.id} className="hover:bg-gray-700">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {getFileTypeIcon(file)}
                            <span className="font-medium text-sm text-gray-200">{file.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400">{formatFileSize(file.size)}</td>
                        <td className="px-4 py-3 text-sm text-gray-400">{formatRelativeDate(file.modified)}</td>
                        <td className="px-4 py-3 text-sm text-gray-400">v{file.version}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs ${file.synced ? 'bg-green-900 text-green-400' : 'bg-orange-900 text-orange-400'} px-2 py-1 rounded`}>
                            {file.synced ? 'Synced' : 'Pending'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button 
                            className="p-1 text-gray-400 hover:text-teal-400"
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
                <div className="py-8 text-center text-gray-400">
                  <p>No files in this folder yet</p>
                  <div className="flex justify-center gap-4 mt-4">
                    <button 
                      className="text-teal-400 hover:text-teal-300 text-sm font-medium"
                      onClick={() => setUploadFormVisible(true)}
                    >
                      Upload files
                    </button>
                    <button 
                      className="text-teal-400 hover:text-teal-300 text-sm font-medium"
                      onClick={() => addDefaultFilesToFolder(currentFolder.id)}
                    >
                      Add sample files
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            {/* Blockchain Transactions */}
            <div className="mt-6 bg-gray-800 shadow-sm rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700 flex justify-between items-center">
                <h3 className="font-medium text-gray-200">Blockchain Metadata</h3>
                <button className="text-xs text-teal-400 flex items-center gap-1">
                  <ExternalLink size={12} />
                  View on Explorer
                </button>
              </div>
              
              {transactions.filter(tx => tx.fileInfo && tx.fileInfo.folderId === currentFolder.id).length > 0 ? (
                <div className="divide-y divide-gray-700">
                  {transactions
                    .filter(tx => tx.fileInfo && tx.fileInfo.folderId === currentFolder.id)
                    .slice(0, 5)
                    .map((tx, index) => (
                      <div key={index} className="p-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium text-sm text-gray-200">{tx.fileInfo.name}</p>
                            <p className="text-xs text-gray-400">{formatFileSize(tx.fileInfo.size)}</p>
                          </div>
                          <span className="text-xs bg-teal-900 text-teal-400 px-2 py-1 rounded">
                            {truncateHash(tx.hash)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          {new Date(tx.timestamp).toLocaleString()}
                        </p>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="py-8 text-center text-gray-400">
                  <p>No blockchain transactions for this folder yet</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-6 flex flex-col items-center justify-center h-full text-center">
            <div className="mb-4 text-gray-500">
              <FolderOpen size={64} />
            </div>
            <h2 className="text-xl font-semibold mb-2 text-gray-200">No Folder Selected</h2>
            <p className="text-gray-400 mb-6 max-w-md">Select a folder from the sidebar or create a new one to get started</p>
            <div className="flex gap-4">
              <button 
                className="bg-teal-600 hover:bg-teal-500 text-white rounded-md py-2 px-4 font-medium"
                onClick={() => setNewFolderModal(true)}
              >
                Add New Folder
              </button>
              <button 
                className="bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-md py-2 px-4 font-medium"
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
      <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50">
        <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
          <h3 className="text-lg font-semibold mb-4 text-gray-200">Share "{sharingModal.folder.name}"</h3>
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-gray-300">Share Key</label>
            <div className="flex">
              <input
                type="text"
                value={sharingModal.folder.secretKey}
                readOnly
                className="flex-1 p-2 border border-gray-600 rounded-l-md bg-gray-700 text-gray-200"
              />
              <button
                onClick={() => copyShareKey(sharingModal.folder.secretKey)}
                className="bg-gray-600 border border-gray-600 border-l-0 rounded-r-md p-2 px-3 hover:bg-gray-500 text-gray-200"
              >
                <Copy size={18} />
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Share this key with others to give them access to this folder
            </p>
          </div>
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-gray-300">Permission</label>
            <select 
              className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-200"
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
              <span className="text-sm text-gray-300">Encrypt data transfers</span>
            </label>
          </div>
          
          <div className="flex justify-end gap-2">
            <button 
              className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-gray-700"
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
      <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50">
        <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
          <h3 className="text-lg font-semibold mb-4 text-gray-200">Add New Folder</h3>
          
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
              <label className="block text-sm font-medium mb-1 text-gray-300" htmlFor="name">Folder Name</label>
              <input
                type="text"
                id="name"
                name="name"
                required
                className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-200"
                placeholder="My Folder"
              />
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1 text-gray-300" htmlFor="path">Folder Path (optional)</label>
              <input
                type="text"
                id="path"
                name="path"
                className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-200"
                placeholder="/path/to/folder"
              />
              <p className="text-xs text-gray-400 mt-1">Leave empty to generate automatically</p>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1 text-gray-300" htmlFor="color">Color</label>
              <select
                id="color"
                name="color"
                className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-200"
              >
                <option value="#4F46E5">Blue</option>
                <option value="#10B981">Green</option>
                <option value="#F59E0B">Yellow</option>
                <option value="#EF4444">Red</option>
                <option value="#8B5CF6">Purple</option>
                <option value="#EC4899">Pink</option>
                <option value="#06B6D4">Teal</option>
                <option value="#F97316">Orange</option>
              </select>
            </div>
            
            <div className="mb-4">
              <label className="flex items-center">
                <input 
                  type="checkbox"
                  name="shared"
                  className="mr-2"
                />
                <span className="text-sm text-gray-300">Share this folder</span>
              </label>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1 text-gray-300" htmlFor="shareMode">Share Permission</label>
              <select 
                id="shareMode"
                name="shareMode"
                className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-200"
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
                <span className="text-sm text-gray-300">Encrypt data transfers</span>
              </label>
            </div>
            
            <div className="flex justify-end gap-2">
              <button 
                type="button"
                className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-gray-700"
                onClick={() => setNewFolderModal(false)}
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-500"
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
          notification.type === 'success' ? 'bg-green-800 text-green-200 border-l-4 border-green-500' :
          notification.type === 'error' ? 'bg-red-800 text-red-200 border-l-4 border-red-500' :
          'bg-blue-800 text-blue-200 border-l-4 border-blue-500'
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