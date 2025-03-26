import React, { useState, useEffect } from 'react';
import { Upload, Download, Check, Copy, Link, FolderOpen, Settings, Plus, Trash, 
  RefreshCw, FileText, Share2, HardDrive, Lock, ExternalLink, LogOut, User } from 'lucide-react';

// Import Firebase services
import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged 
} from "firebase/auth";

import { 
  ref, 
  set, 
  onValue, 
  remove, 
  push, 
  get 
} from "firebase/database";

import { 
  ref as storageRef, 
  uploadBytes, 
  getDownloadURL 
} from "firebase/storage";

// Import Firebase instances
import { auth, db, storage } from './firebase';

const BlockSyncApp = () => {
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

  // Sign in with Google
  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      showNotification('Signed in successfully', 'success');
    } catch (error) {
      console.error("Error signing in: ", error);
      showNotification('Sign-in failed: ' + error.message, 'error');
    }
  };

  // Sign out
  const handleSignOut = async () => {
    try {
      // Update user status to offline
      if (user) {
        try {
          const userStatusRef = ref(db, `userStatus/${user.uid}`);
          await set(userStatusRef, {
            online: false,
            lastActive: new Date().toISOString()
          });
        } catch (e) {
          console.error("Error updating user status:", e);
        }
      }
      
      // Sign out from Firebase
      await signOut(auth);
      
      // Clear state
      setSyncFolders([]);
      setCurrentFolder(null);
      setFolderFiles([]);
      
      showNotification('Signed out successfully', 'info');
    } catch (error) {
      console.error("Error signing out: ", error);
      showNotification('Sign-out failed: ' + error.message, 'error');
    }
  };
  
  // Initialize and auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUser(user);
        try {
          localStorage.setItem('blocksync_user', JSON.stringify(user));
        } catch (e) {
          console.error("Error saving to localStorage:", e);
        }
        
        // Load user data
        loadUserData(user.uid);
        
        // Register this user as online
        try {
          const userStatusRef = ref(db, `userStatus/${user.uid}`);
          set(userStatusRef, {
            online: true,
            lastActive: new Date().toISOString(),
            displayName: user.displayName,
            email: user.email,
            deviceId: activeDevice.id
          });
        } catch (e) {
          console.error("Error updating user status:", e);
        }
        
        // Set up listener for user's share notifications
        setupShareNotificationListener(user.uid);
      } else {
        setUser(null);
        setSyncFolders([]);
        setCurrentFolder(null);
        setFolderFiles([]);
      }
      setIsAuthLoading(false);
    });
    
    return () => {
      unsubscribe();
      // Handle disconnect if user was logged in
      if (user) {
        try {
          const userStatusRef = ref(db, `userStatus/${user.uid}`);
          set(userStatusRef, {
            online: false,
            lastActive: new Date().toISOString()
          });
        } catch (e) {
          console.error("Error updating user status on cleanup:", e);
        }
      }
    };
  }, []);
  
  // Set up listener for share notifications
  const setupShareNotificationListener = (userId) => {
    try {
      // Listen for folder shares
      const sharesRef = ref(db, `shares/${userId}`);
      onValue(sharesRef, (snapshot) => {
        const sharesData = snapshot.val();
        if (!sharesData) return;
        
        // Process each pending share
        Object.keys(sharesData).forEach(shareId => {
          const shareInfo = sharesData[shareId];
          
          if (shareInfo.type === 'folder') {
            // Handle a shared folder
            processFolderShare(shareInfo, shareId);
          } else if (shareInfo.type === 'file') {
            // Handle a shared file
            processFileShare(shareInfo, shareId);
          }
        });
      });
    } catch (e) {
      console.error("Error setting up share notification listener:", e);
    }
  };
  
  // Process an incoming folder share
  const processFolderShare = async (shareInfo, shareId) => {
    try {
      // Get folder details from database
      const folderRef = ref(db, `folders/${shareInfo.folderId}`);
      const folderSnapshot = await get(folderRef);
      
      if (folderSnapshot.exists()) {
        const folderData = folderSnapshot.val();
        
        // Prepare folder for adding to local state
        const newFolder = {
          id: shareInfo.folderId,
          name: folderData.name,
          path: folderData.path || `/shared/${folderData.name.toLowerCase().replace(/\s+/g, '-')}`,
          size: folderData.size || 0,
          created: new Date(folderData.created),
          modified: new Date(folderData.modified),
          shared: true,
          shareMode: shareInfo.permission || 'read-only',
          secretKey: folderData.secretKey,
          version: folderData.version || 1,
          devices: folderData.devices || 1,
          syncEnabled: true,
          encrypted: folderData.encrypted || true,
          owner: false,
          files: [],
          color: folderData.color || '#EC4899'
        };
        
        // Check if folder already exists in our state
        const existingFolder = syncFolders.find(f => f.id === newFolder.id);
        
        if (!existingFolder) {
          // Add the new folder
          setSyncFolders(prev => [...prev, newFolder]);
          
          // Set as current folder
          setCurrentFolder(newFolder);
          
          // Fetch files for this folder
          fetchFilesForFolder(newFolder.id);
          
          showNotification(`Added shared folder: ${newFolder.name}`, 'success');
        }
        
        // Remove the processed share
        try {
          await remove(ref(db, `shares/${user.uid}/${shareId}`));
        } catch (e) {
          console.error("Error removing processed share:", e);
        }
      }
    } catch (error) {
      console.error('Error processing folder share:', error);
      showNotification('Error adding shared folder', 'error');
    }
  };
  
  // Process an incoming file share
  const processFileShare = async (shareInfo, shareId) => {
    try {
      // Get file details from database
      const fileRef = ref(db, `files/${shareInfo.fileId}`);
      const fileSnapshot = await get(fileRef);
      
      if (fileSnapshot.exists()) {
        const fileData = fileSnapshot.val();
        
        // Find the folder this file belongs to
        const targetFolder = syncFolders.find(f => f.id === shareInfo.folderId);
        
        if (targetFolder) {
          // Get download URL for the file
          let fileUrl;
          try {
            fileUrl = await getDownloadURL(storageRef(storage, `files/${shareInfo.fileId}`));
          } catch (e) {
            console.error("Error getting download URL:", e);
            fileUrl = null;
          }
          
          // Create the file object
          const newFile = {
            id: shareInfo.fileId,
            name: fileData.name,
            size: fileData.size,
            type: fileData.type || getFileTypeFromName(fileData.name),
            modified: new Date(fileData.modified),
            version: fileData.version || 1,
            synced: true,
            path: `${targetFolder.path}/${fileData.name}`,
            url: fileUrl
          };
          
          // Check if file already exists in folder
          const fileExists = targetFolder.files && targetFolder.files.some(f => f.id === newFile.id);
          
          if (!fileExists) {
            // Create a transaction record
            const transaction = {
              hash: '0x' + Math.random().toString(16).substr(2, 40),
              timestamp: new Date().toISOString(),
              sender: shareInfo.fromUserId,
              fileInfo: {
                name: newFile.name,
                size: newFile.size,
                type: newFile.type,
                infoHash: newFile.id,
                folderId: targetFolder.id
              }
            };
            
            // Add transaction
            setTransactions(prev => [transaction, ...prev]);
            
            // Update folder with the new file
            setSyncFolders(prev => 
              prev.map(folder => {
                if (folder.id === targetFolder.id) {
                  const updatedFiles = [...(folder.files || []), newFile];
                  return {
                    ...folder,
                    files: updatedFiles,
                    size: folder.size + newFile.size,
                    modified: new Date()
                  };
                }
                return folder;
              })
            );
            
            // If this is the current folder, update the view
            if (currentFolder && currentFolder.id === targetFolder.id) {
              setFolderFiles(prev => [...prev, newFile]);
              
              // Update current folder
              setCurrentFolder(prevFolder => {
                if (!prevFolder) return null;
                
                const updatedFiles = [...(prevFolder.files || []), newFile];
                return {
                  ...prevFolder,
                  files: updatedFiles,
                  size: prevFolder.size + newFile.size,
                  modified: new Date()
                };
              });
            }
            
            showNotification(`Received file: ${newFile.name}`, 'success');
          }
          
          // Remove the processed share
          try {
            await remove(ref(db, `shares/${user.uid}/${shareId}`));
          } catch (e) {
            console.error("Error removing processed share:", e);
          }
        }
      }
    } catch (error) {
      console.error('Error processing file share:', error);
      showNotification('Error adding shared file', 'error');
    }
  };
  
  // Fetch files for a specific folder
  const fetchFilesForFolder = async (folderId) => {
    try {
      // Get list of files for this folder
      const folderFilesRef = ref(db, `folderFiles/${folderId}`);
      const snapshot = await get(folderFilesRef);
      
      if (snapshot.exists()) {
        const folderFilesData = snapshot.val();
        const fileIds = Object.keys(folderFilesData);
        
        // Process each file
        const filesPromises = fileIds.map(async (fileId) => {
          // Get file metadata
          const fileRef = ref(db, `files/${fileId}`);
          const fileSnapshot = await get(fileRef);
          
          if (fileSnapshot.exists()) {
            const fileData = fileSnapshot.val();
            
            // Get download URL
            try {
              const fileUrl = await getDownloadURL(storageRef(storage, `files/${fileId}`));
              
              // Return complete file object
              return {
                id: fileId,
                name: fileData.name,
                size: fileData.size,
                type: fileData.type || getFileTypeFromName(fileData.name),
                modified: new Date(fileData.modified),
                version: fileData.version || 1,
                synced: true,
                url: fileUrl
              };
            } catch (e) {
              console.error(`Error getting download URL for file ${fileId}:`, e);
              // Return file without URL if there's an error
              return {
                id: fileId,
                name: fileData.name,
                size: fileData.size,
                type: fileData.type || getFileTypeFromName(fileData.name),
                modified: new Date(fileData.modified),
                version: fileData.version || 1,
                synced: false,
                url: null
              };
            }
          }
          return null;
        });
        
        // Wait for all file details to be fetched
        const files = (await Promise.all(filesPromises)).filter(Boolean);
        
        // Calculate total size
        const totalSize = files.reduce((sum, file) => sum + file.size, 0);
        
        // Update folder with files
        setSyncFolders(prev => 
          prev.map(folder => {
            if (folder.id === folderId) {
              return {
                ...folder,
                files,
                size: totalSize,
                modified: new Date()
              };
            }
            return folder;
          })
        );
        
        // If this is current folder, update file view
        if (currentFolder && currentFolder.id === folderId) {
          // Add path to files for the view
          const filesWithPath = files.map(file => ({
            ...file,
            path: `${currentFolder.path}/${file.name}`
          }));
          
          setFolderFiles(filesWithPath);
          
          // Update current folder
          setCurrentFolder(prev => {
            if (!prev) return null;
            
            return {
              ...prev,
              files,
              size: totalSize,
              modified: new Date()
            };
          });
        }
      } else {
        // No files found, create an empty array
        if (currentFolder && currentFolder.id === folderId) {
          setFolderFiles([]);
        }
      }
    } catch (error) {
      console.error('Error fetching files for folder:', error);
      showNotification('Error loading folder files', 'error');
    }
  };
  
  // Load user data from Firebase
  const loadUserData = async (userId) => {
    try {
      // Load user's folders from Firebase
      const userFoldersRef = ref(db, `userFolders/${userId}`);
      const snapshot = await get(userFoldersRef);
      
      if (snapshot.exists()) {
        const userFolders = snapshot.val();
        const folderPromises = Object.keys(userFolders).map(async (folderId) => {
          // Get folder details
          const folderRef = ref(db, `folders/${folderId}`);
          const folderSnapshot = await get(folderRef);
          
          if (folderSnapshot.exists()) {
            const folderData = folderSnapshot.val();
            
            // Prepare folder object
            return {
              id: folderId,
              name: folderData.name,
              path: folderData.path || `/${folderData.name.toLowerCase().replace(/\s+/g, '-')}`,
              size: folderData.size || 0,
              created: new Date(folderData.created),
              modified: new Date(folderData.modified),
              shared: folderData.shared || false,
              shareMode: folderData.shareMode || 'read-write',
              secretKey: folderData.secretKey,
              version: folderData.version || 1,
              devices: folderData.devices || 1,
              syncEnabled: true,
              encrypted: folderData.encrypted || true,
              owner: folderData.ownerId === userId,
              files: [],
              color: folderData.color || '#4F46E5'
            };
          }
          return null;
        });
        
        // Wait for all folder details to be fetched
        const folders = (await Promise.all(folderPromises)).filter(Boolean);
        
        // Set folders
        setSyncFolders(folders);
        
        // Also load transaction history
        loadTransactionHistory(userId);
      } else {
        // No folders found, set empty array
        setSyncFolders([]);
        
        // Create a first folder for new users
        await createSyncFolder({
          name: "My First Folder",
          shared: false,
          encrypted: true,
          color: '#4F46E5'
        });
      }
    } catch (error) {
      console.error('Error loading user data:', error);
      showNotification('Error loading your data', 'error');
    }
  };
  
  // Load transaction history
  const loadTransactionHistory = async (userId) => {
    try {
      const transactionsRef = ref(db, `userTransactions/${userId}`);
      const snapshot = await get(transactionsRef);
      
      if (snapshot.exists()) {
        const txData = snapshot.val();
        const txList = Object.values(txData);
        
        // Sort by timestamp, newest first
        txList.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        setTransactions(txList);
      } else {
        setTransactions([]);
      }
    } catch (error) {
      console.error('Error loading transactions:', error);
      // Set empty transactions array on error
      setTransactions([]);
    }
  };
  
  // Create a new sync folder
  const createSyncFolder = async (folderData) => {
    if (!user) {
      showNotification('You must be signed in to create folders', 'error');
      return;
    }
    
    try {
      // Generate folder ID
      const folderId = 'folder_' + Math.random().toString(36).substr(2, 9);
      
      // Generate a secret key
      const secretKey = 'B' + Math.random().toString(36).substr(2, 25).toUpperCase();
      
      // Prepare folder object for Firebase
      const newFolder = {
        name: folderData.name,
        path: folderData.path || `/${folderData.name.toLowerCase().replace(/\s+/g, '-')}`,
        size: 0,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        shared: folderData.shared || false,
        shareMode: folderData.shareMode || 'read-write',
        secretKey: secretKey,
        version: 1,
        devices: 1,
        encrypted: folderData.encrypted || true,
        ownerId: user.uid,
        color: folderData.color || '#4F46E5'
      };
      
      // Create local version of folder
      const localFolder = {
        ...newFolder,
        id: folderId,
        created: new Date(newFolder.created),
        modified: new Date(newFolder.modified),
        owner: true,
        files: []
      };
      
      // Add to state
      setSyncFolders(prevFolders => [...prevFolders, localFolder]);
      
      // Set as current folder
      setCurrentFolder(localFolder);
      
      // Close the modal
      setNewFolderModal(false);
      
      // Save to Firebase
      const folderRef = ref(db, `folders/${folderId}`);
      await set(folderRef, newFolder);
      
      // Add to user's folders
      const userFolderRef = ref(db, `userFolders/${user.uid}/${folderId}`);
      await set(userFolderRef, { 
        added: new Date().toISOString(),
        permission: 'owner'
      });
      
      showNotification(`Folder "${folderData.name}" created successfully`, 'success');
      
      return localFolder;
    } catch (error) {
      console.error('Error creating folder:', error);
      showNotification('Error creating folder', 'error');
      return null;
    }
  };
  
  // Add a folder using a secret key
  const addFolderByKey = async (secretKey) => {
    if (!user) {
      showNotification('You must be signed in to add folders', 'error');
      return;
    }
    
    // Validate key
    if (!secretKey || secretKey.trim() === '') {
      showNotification('Please enter a valid share key', 'error');
      return;
    }
  
    // Check if already exists
    const existingFolder = syncFolders.find(folder => folder.secretKey === secretKey);
    if (existingFolder) {
      showNotification('This folder is already in your library', 'error');
      return;
    }
    
    showNotification('Looking for shared folder...', 'info');
    
    try {
      // Try to get the shared folder info from Firebase
      const sharedFoldersRef = ref(db, 'sharedFolders');
      const snapshot = await get(sharedFoldersRef);
      
      if (snapshot.exists()) {
        const foldersData = snapshot.val();
        
        // Find folder with this key
        const matchingFolder = Object.entries(foldersData).find(([id, data]) => data.secretKey === secretKey);
        
        if (matchingFolder) {
          const [folderId, folderData] = matchingFolder;
          
          // Add folder to user's collection
          const newFolder = {
            id: folderId,
            name: folderData.name,
            path: folderData.path || `/shared/${folderData.name.toLowerCase().replace(/\s+/g, '-')}`,
            size: folderData.size || 0,
            created: new Date(folderData.created),
            modified: new Date(folderData.modified),
            shared: true,
            shareMode: 'read-only',
            secretKey: secretKey,
            version: folderData.version || 1,
            devices: folderData.devices || 2,
            syncEnabled: true,
            encrypted: folderData.encrypted || true,
            owner: false,
            files: [],
            color: folderData.color || '#EC4899'
          };
          
          // Add folder to state
          setSyncFolders(prev => [...prev, newFolder]);
          
          // Set as current folder
          setCurrentFolder(newFolder);
          
          // Add folder to user's folders in Firebase
          const userFolderRef = ref(db, `userFolders/${user.uid}/${folderId}`);
          await set(userFolderRef, { 
            added: new Date().toISOString(),
            permission: 'reader'
          });
          
          // Load files for this folder
          try {
            const filesRef = ref(db, `sharedFolderFiles/${folderId}`);
            const filesSnapshot = await get(filesRef);
            
            if (filesSnapshot.exists()) {
              const filesData = filesSnapshot.val();
              
              // Get file details and download URLs
              const filePromises = Object.entries(filesData).map(async ([fileId, fileData]) => {
                try {
                  // Get file download URL
                  const fileDownloadUrl = await getDownloadURL(storageRef(storage, `sharedFiles/${fileId}`));
                  
                  return {
                    id: fileId,
                    name: fileData.name,
                    size: fileData.size,
                    type: fileData.type || getFileTypeFromName(fileData.name),
                    modified: new Date(fileData.modified),
                    version: fileData.version || 1,
                    synced: true,
                    path: `${newFolder.path}/${fileData.name}`,
                    url: fileDownloadUrl
                  };
                } catch (error) {
                  console.error(`Error getting download URL for file ${fileId}:`, error);
                  return null;
                }
              });
              
              // Wait for all file details
              const files = (await Promise.all(filePromises)).filter(Boolean);
              
              if (files.length > 0) {
                // Update folder with files
                setSyncFolders(prev => prev.map(folder => {
                  if (folder.id === folderId) {
                    return {
                      ...folder,
                      files,
                      size: files.reduce((sum, file) => sum + file.size, 0)
                    };
                  }
                  return folder;
                }));
                
                // If this is current folder, update files view
                if (currentFolder && currentFolder.id === folderId) {
                  setFolderFiles(files);
                }
                
                showNotification(`Folder "${newFolder.name}" added with ${files.length} files`, 'success');
              } else {
                showNotification(`Folder "${newFolder.name}" added`, 'success');
              }
            } else {
              showNotification(`Folder "${newFolder.name}" added (no files)`, 'success');
            }
          } catch (fileError) {
            console.error('Error loading shared folder files:', fileError);
            showNotification(`Folder "${newFolder.name}" added (could not load files)`, 'success');
          }
          
          return newFolder;
        }
      }
      
      // If we get here, we didn't find the folder
      showNotification('Folder not found with this share key', 'error');
      return null;
      
    } catch (error) {
      console.error('Error adding folder by key:', error);
      showNotification('Error adding folder: ' + error.message, 'error');
      return null;
    }
  };
  
  // Share folder with other users
  const shareFolder = (folder) => {
    setSharingModal({ open: true, folder });
    
    try {
      // Save folder information to Firebase for sharing
      const sharedFolderRef = ref(db, `sharedFolders/${folder.id}`);
      
      const folderForSharing = {
        name: folder.name,
        path: folder.path,
        size: folder.size,
        created: folder.created.toISOString(),
        modified: folder.modified.toISOString(),
        shared: true,
        shareMode: folder.shareMode,
        secretKey: folder.secretKey,
        version: folder.version,
        devices: folder.devices,
        encrypted: folder.encrypted,
        color: folder.color
      };
      
      // Save folder data
      set(sharedFolderRef, folderForSharing).catch(err => console.error("Error saving shared folder:", err));
      
      // Save the files
      if (folder.files && folder.files.length > 0) {
        folder.files.forEach(file => {
          try {
            // Save file metadata
            const fileRef = ref(db, `sharedFolderFiles/${folder.id}/${file.id}`);
            const fileData = {
              name: file.name,
              size: file.size,
              type: file.type,
              modified: new Date().toISOString(),
              version: file.version
            };
            
            set(fileRef, fileData).catch(err => console.error("Error saving file metadata:", err));
            
            // If we have a file URL, upload content to Firebase Storage
            if (file.url) {
              try {
                fetch(file.url)
                  .then(response => response.blob())
                  .then(blob => {
                    const fileStorageRef = storageRef(storage, `sharedFiles/${file.id}`);
                    uploadBytes(fileStorageRef, blob).catch(err => console.error("Error uploading file:", err));
                  })
                  .catch(err => console.error("Error fetching file content:", err));
              } catch (e) {
                console.error("Error preparing file upload:", e);
              }
            }
          } catch (e) {
            console.error("Error processing file for sharing:", e);
          }
        });
      }
      
      // Update folder in state
      setSyncFolders(prev => prev.map(f => {
        if (f.id === folder.id) {
          return {
            ...f,
            shared: true,
            shareMode: folder.shareMode
          };
        }
        return f;
      }));
      
    } catch (error) {
      console.error("Error sharing folder:", error);
    }
  };
  
  // Share folder with a specific user by email
  const shareFolderWithUser = async (folder, userEmail, permission = 'read-only') => {
    if (!user || !folder) return;
    
    try {
      // Find the user by email
      const usersRef = ref(db, 'userStatus');
      const snapshot = await get(usersRef);
      
      if (snapshot.exists()) {
        const usersData = snapshot.val();
        let targetUserId = null;
        
        // Find user by email
        Object.entries(usersData).forEach(([id, data]) => {
          if (data.email && data.email.toLowerCase() === userEmail.toLowerCase()) {
            targetUserId = id;
          }
        });
        
        if (targetUserId) {
          // Create a share record
          const shareRef = ref(db, `shares/${targetUserId}/${Math.random().toString(36).substr(2, 9)}`);
          await set(shareRef, {
            type: 'folder',
            folderId: folder.id,
            fromUserId: user.uid,
            fromName: user.displayName,
            permission: permission,
            timestamp: new Date().toISOString()
          });
          
          showNotification(`Folder shared with ${userEmail}`, 'success');
          return true;
        } else {
          showNotification('User not found with this email', 'error');
        }
      } else {
        showNotification('No users found in the system', 'error');
      }
    } catch (error) {
      console.error('Error sharing folder with user:', error);
      showNotification('Error sharing folder: ' + error.message, 'error');
    }
    
    return false;
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
  
  // Delete a folder
  const deleteFolder = async (folderId) => {
    if (!user) return;
    
    try {
      const folder = syncFolders.find(f => f.id === folderId);
      if (!folder) return;
      
      // Revoke object URLs for files
      if (folder.files) {
        folder.files.forEach(file => {
          if (file.url && file.url.startsWith('blob:')) {
            try {
              URL.revokeObjectURL(file.url);
            } catch (e) {
              console.error("Error revoking object URL:", e);
            }
          }
        });
      }
      
      // Remove from Firebase
      await remove(ref(db, `userFolders/${user.uid}/${folderId}`));
      
      // If user is owner, also cleanup shared data
      if (folder.owner) {
        await remove(ref(db, `folders/${folderId}`));
        await remove(ref(db, `sharedFolders/${folderId}`));
        await remove(ref(db, `folderFiles/${folderId}`));
        await remove(ref(db, `sharedFolderFiles/${folderId}`));
      }
      
      // Remove from state
      setSyncFolders(prev => prev.filter(f => f.id !== folderId));
      
      // Reset current folder if needed
      if (currentFolder && currentFolder.id === folderId) {
        setCurrentFolder(null);
        setFolderFiles([]);
      }
      
      showNotification('Folder removed', 'info');
    } catch (error) {
      console.error('Error deleting folder:', error);
      showNotification('Error removing folder: ' + error.message, 'error');
    }
  };
  
  // Toggle sync for a folder
  const toggleFolderSync = async (folderId) => {
    setSyncFolders(prev => prev.map(folder => 
      folder.id === folderId 
        ? { ...folder, syncEnabled: !folder.syncEnabled } 
        : folder
    ));
    
    // Update in Firebase
    try {
      const folder = syncFolders.find(f => f.id === folderId);
      if (folder) {
        const folderSyncRef = ref(db, `userFolders/${user.uid}/${folderId}/syncEnabled`);
        await set(folderSyncRef, !folder.syncEnabled);
      }
    } catch (error) {
      console.error('Error updating sync status:', error);
    }
    
    showNotification('Sync status updated', 'info');
  };
  
  // Handle file upload
  const handleFileUpload = async (event) => {
    if (!user || !currentFolder) {
      showNotification('Please select a folder first', 'error');
      return;
    }
    
    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    
    // Display selected files
    setSelectedFiles(files);
    showNotification('Uploading files...', 'info');
    
    try {
      // Process each file
      const uploadPromises = files.map(file => uploadFile(file, currentFolder));
      
      // Wait for all uploads to complete
      const uploadedFiles = await Promise.all(uploadPromises);
      
      // Filter out any failed uploads
      const successfulUploads = uploadedFiles.filter(Boolean);
      
      if (successfulUploads.length > 0) {
        showNotification(`${successfulUploads.length} file${successfulUploads.length !== 1 ? 's' : ''} uploaded successfully`, 'success');
      } else {
        showNotification('No files were uploaded successfully', 'error');
      }
      
      // Reset form
      event.target.value = null;
      setSelectedFiles([]);
      setUploadFormVisible(false);
    } catch (error) {
      console.error('Error uploading files:', error);
      showNotification('Error uploading files: ' + error.message, 'error');
    }
  };
  
  // Upload a file
  const uploadFile = async (file, folder) => {
    if (!user || !folder) return null;
    
    try {
      // Generate a unique file ID
      const fileId = 'file_' + Math.random().toString(36).substr(2, 9);
      
      // Upload file to Firebase Storage
      const fileStorageRef = storageRef(storage, `files/${fileId}`);
      const uploadResult = await uploadBytes(fileStorageRef, file);
      
      // Get download URL
      const fileUrl = await getDownloadURL(fileStorageRef);
      
      // Save file metadata to Firebase
      const fileRef = ref(db, `files/${fileId}`);
      const fileData = {
        name: file.name,
        size: file.size,
        type: getFileTypeFromName(file.name),
        modified: new Date().toISOString(),
        version: 1,
        uploadedBy: user.uid
      };
      
      await set(fileRef, fileData);
      
      // Link file to folder
      const folderFileRef = ref(db, `folderFiles/${folder.id}/${fileId}`);
      await set(folderFileRef, true);
      
      // Create a transaction record
      const transactionId = Math.random().toString(36).substr(2, 9);
      const transaction = {
        hash: '0x' + Math.random().toString(16).substr(2, 40),
        timestamp: new Date().toISOString(),
        sender: user.uid,
        fileInfo: {
          name: file.name,
          size: file.size,
          type: getFileTypeFromName(file.name),
          infoHash: fileId,
          folderId: folder.id
        }
      };
      
      // Save transaction to Firebase
      const transactionRef = ref(db, `userTransactions/${user.uid}/${transactionId}`);
      await set(transactionRef, transaction);
      
      // Add transaction to state
      setTransactions(prev => [transaction, ...prev]);
      
      // Create file object for state
      const fileObj = {
        id: fileId,
        name: file.name,
        size: file.size,
        modified: new Date(),
        type: getFileTypeFromName(file.name),
        version: 1,
        synced: true,
        path: `${folder.path}/${file.name}`,
        url: fileUrl
      };
      
      // Update folder with the new file
      setSyncFolders(prev => 
        prev.map(f => {
          if (f.id === folder.id) {
            const updatedFiles = [...(f.files || []), fileObj];
            return {
              ...f,
              files: updatedFiles,
              size: f.size + file.size,
              modified: new Date()
            };
          }
          return f;
        })
      );
      
      // Update folder size in Firebase
      const folderSizeRef = ref(db, `folders/${folder.id}/size`);
      const folderSnapshot = await get(ref(db, `folders/${folder.id}`));
      if (folderSnapshot.exists()) {
        const folderData = folderSnapshot.val();
        const newSize = (folderData.size || 0) + file.size;
        await set(folderSizeRef, newSize);
      }
      
      // Update folder modified date in Firebase
      const folderModifiedRef = ref(db, `folders/${folder.id}/modified`);
      await set(folderModifiedRef, new Date().toISOString());
      
      // If this is the current folder, update the view
      if (currentFolder && currentFolder.id === folder.id) {
        setFolderFiles(prev => [...prev, fileObj]);
        
        // Update current folder
        setCurrentFolder(prevFolder => {
          if (!prevFolder) return null;
          
          const updatedFiles = [...(prevFolder.files || []), fileObj];
          return {
            ...prevFolder,
            files: updatedFiles,
            size: prevFolder.size + file.size,
            modified: new Date()
          };
        });
      }
      
      // If folder is shared, update the shared folder data
      if (folder.shared) {
        // Save file metadata to shared folder
        const sharedFileRef = ref(db, `sharedFolderFiles/${folder.id}/${fileId}`);
        await set(sharedFileRef, fileData);
        
        // Upload to shared storage location
        const sharedFileStorageRef = storageRef(storage, `sharedFiles/${fileId}`);
        await uploadBytes(sharedFileStorageRef, file);
      }
      
      return fileObj;
    } catch (error) {
      console.error(`Error uploading file ${file.name}:`, error);
      showNotification(`Error uploading ${file.name}: ${error.message}`, 'error');
      return null;
    }
  };
  
  // Share file with all users who have access to a folder
  const shareFileWithFolderUsers = async (fileId, folderId) => {
    if (!user) return;
    
    try {
      // Get users who have access to this folder
      const usersRef = ref(db, `userFolders`);
      const snapshot = await get(usersRef);
      
      if (snapshot.exists()) {
        const usersData = snapshot.val();
        let shareCount = 0;
        
        // For each user
        for (const [userId, folders] of Object.entries(usersData)) {
          // Skip current user
          if (userId === user.uid) continue;
          
          // Check if user has this folder
          if (folders[folderId]) {
            // Share the file with this user
            const shareRef = ref(db, `shares/${userId}/${Math.random().toString(36).substr(2, 9)}`);
            await set(shareRef, {
              type: 'file',
              fileId: fileId,
              folderId: folderId,
              fromUserId: user.uid,
              fromName: user.displayName,
              timestamp: new Date().toISOString()
            });
            
            shareCount++;
          }
        }
        
        if (shareCount > 0) {
          showNotification(`File shared with ${shareCount} user${shareCount !== 1 ? 's' : ''}`, 'success');
        } else {
          showNotification('No other users have access to this folder', 'info');
        }
      }
    } catch (error) {
      console.error('Error sharing file with folder users:', error);
      showNotification('Error sharing file: ' + error.message, 'error');
    }
  };
  
  // Download a file
  const downloadFile = (file) => {
    if (file.url) {
      try {
        // Create anchor and trigger download
        const a = document.createElement('a');
        a.href = file.url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        showNotification(`File "${file.name}" downloaded`, 'success');
      } catch (e) {
        console.error("Error downloading file:", e);
        showNotification('Error downloading file: ' + e.message, 'error');
      }
    } else {
      showNotification('File URL not available', 'error');
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
      return diffHour === 1 ? '1 hour ago' : `${diffHour} hours ago`;
    } else if (diffMin > 0) {
      return diffMin === 1 ? '1 minute ago' : `${diffMin} minutes ago`;
    } else {
      return 'Just now';
    }
  };
  
  // Helper to determine file type from filename
  const getFileTypeFromName = (filename) => {
    if (!filename) return 'other';
    
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
  
  // Get status color class
  const getSyncStatusColor = (folder) => {
    if (!folder.syncEnabled) return 'bg-gray-400';
    return 'bg-green-500';
  };
  
  // Truncate blockchain hash
  const truncateHash = (hash) => {
    if (!hash) return '';
    return hash.substring(0, 6) + '...' + hash.substring(hash.length - 4);
  };
  
  // Load files for a folder when selected
  useEffect(() => {
    if (currentFolder) {
      const folder = syncFolders.find(f => f.id === currentFolder.id);
      
      if (folder) {
        // Update current folder reference to ensure it's the latest version
        setCurrentFolder(folder);
        
        // If folder has no files yet, fetch them
        if (!folder.files || folder.files.length === 0) {
          fetchFilesForFolder(folder.id);
        } else {
          // Process and display files
          const fullFiles = folder.files.map(fileRef => ({
            ...fileRef,
            path: `${folder.path}/${fileRef.name}`
          }));
          
          setFolderFiles(fullFiles);
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
            Sign in with Google
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
            {/* Device info */}
            <div className="text-sm flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <span>{activeDevice.name}</span>
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
                  <button 
                    className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg p-3 mb-6 flex items-center justify-center gap-2"
                    onClick={() => setUploadFormVisible(true)}
                  >
                    <Upload size={18} />
                    Upload Files
                  </button>
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
                              {file.synced ? 'Synced' : 'Syncing...'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button 
                              className="p-1 text-gray-500 hover:text-blue-500"
                              onClick={() => downloadFile(file)}
                              disabled={!file.url}
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
                    <button 
                      className="mt-4 text-blue-500 hover:text-blue-700 text-sm font-medium"
                      onClick={() => setUploadFormVisible(true)}
                    >
                      Upload files to get started
                    </button>
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
            
            {/* Direct user sharing */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Share with User</label>
              <div className="flex">
                <input
                  type="email"
                  id="shareEmail"
                  placeholder="Enter user email"
                  className="flex-1 p-2 border rounded-l-md"
                />
                <button
                  onClick={() => {
                    const emailInput = document.getElementById('shareEmail');
                    if (emailInput && emailInput.value) {
                      shareFolderWithUser(
                        sharingModal.folder, 
                        emailInput.value, 
                        sharingModal.folder.shareMode || 'read-only'
                      );
                      emailInput.value = '';
                    } else {
                      showNotification('Please enter an email address', 'error');
                    }
                  }}
                  className="bg-blue-500 text-white border rounded-r-md p-2 px-3 hover:bg-blue-600"
                >
                  Share
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                The user will be notified and can access this folder immediately
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