// Add this script to your project - it will launch the demo setup
// Save this as demo-launcher.js

// This script will:
// 1. Open two tabs with your app
// 2. Automatically set up demo users and shared folders

// Demo configuration
const DEMO_CONFIG = {
    // Demo users (pre-configured for testing)
    users: [
      {
        uid: 'demo-user-1',
        displayName: 'Demo User 1',
        email: 'demo1@example.com',
        photoURL: null
      },
      {
        uid: 'demo-user-2',
        displayName: 'Demo User 2',
        email: 'demo2@example.com',
        photoURL: null
      }
    ],
    
    // Demo shared folder
    sharedFolder: {
      id: 'demo-shared-folder',
      name: 'Shared Project Files',
      path: '/shared-project-files',
      size: 0,
      created: new Date(),
      modified: new Date(),
      shared: true,
      shareMode: 'read-write',
      secretKey: 'BDEMO123456789ABCDEFGHIJKLMNOP',
      version: 1,
      devices: 2,
      syncEnabled: true,
      encrypted: true,
      owner: true,
      files: [],
      color: '#4F46E5'
    },
    
    // Demo files to add to the shared folder
    sharedFiles: [
      {
        name: 'project_plan.txt',
        type: 'document',
        content: 'Project Plan:\n1. Initial research (completed)\n2. Design phase (in progress)\n3. Implementation (scheduled next week)\n4. Testing (pending)\n5. Deployment (pending)'
      },
      {
        name: 'meeting_notes.txt',
        type: 'document',
        content: 'Meeting Notes - March 21, 2025\n\nAttendees: John, Sarah, Mike\nTopics:\n- Project timeline review\n- Budget approval\n- Next steps\n\nAction items:\n1. Sarah to prepare design mockups by Tuesday\n2. Mike to coordinate with the dev team\n3. John to update stakeholders on Friday'
      },
      {
        name: 'budget.txt',
        type: 'document',
        content: 'Project Budget\n\nDevelopment: $45,000\nMarketing: $15,000\nInfrastructure: $12,500\nContingency: $10,000\n\nTotal: $82,500'
      },
      {
        name: 'readme.md',
        type: 'document',
        content: '# Shared Project Repository\n\nThis folder contains shared files for our project. All team members should have access to these files.\n\n## Important Dates\n\n- Project Kickoff: March 15, 2025\n- Phase 1 Completion: April 30, 2025\n- Project Deadline: June 15, 2025'
      }
    ]
  };
  
  // Function to launch the demo setup
  function launchBlockSyncDemo() {
    // 1. Open the first tab and set up the first user
    localStorage.setItem('demo_mode', 'true');
    localStorage.setItem('demo_user_index', '0');
    
    // 2. Open a second tab with the second user
    const secondTabUrl = new URL(window.location.href);
    secondTabUrl.searchParams.set('demo_user', '1');
    window.open(secondTabUrl.toString(), '_blank');
    
    console.log('BlockSync Demo: Launched second tab');
  }
  
  // Call the launcher function
  launchBlockSyncDemo();