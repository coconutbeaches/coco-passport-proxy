/**
 * Example: How to integrate the video URL helper with WhatsApp messaging
 * This demonstrates how to use the helper functions in your WhatsApp bot logic
 */

const { 
  getTourVideoUrl, 
  getTourVideos,
  generateVideoTourMessage, 
  extractStayIdFromUrl 
} = require('../lib/videoUrlHelper');

/**
 * Example WhatsApp message handler
 * This would typically be called from your WhatsApp bot webhook
 */
async function handlePassportRequestMessage(whatsappGroupInfo, userMessage) {
  try {
    // Extract stay_id from the WhatsApp group description URL
    const registrationUrl = whatsappGroupInfo.description; // e.g., "Welcome! Register at https://coco-passport-proxy.vercel.app/register?stay_id=BeachHouse_Smith"
    
    // Method 1: Extract from URL in group description
    const stayId = extractStayIdFromUrl(registrationUrl);
    
    // Method 2: If stay_id is the same as group name (alternative approach)
    // const stayId = whatsappGroupInfo.groupName; // e.g., "BeachHouse_Smith"
    
    if (!stayId) {
      console.error('Could not extract stay_id from group info');
      return sendDefaultMessage();
    }
    
    // Generate the appropriate message with the correct video URL
    const videoTourMessage = generateVideoTourMessage(stayId);
    
    // Send the message via your WhatsApp API
    await sendWhatsAppMessage(whatsappGroupInfo.groupId, videoTourMessage);
    
    console.log(`Sent video tour message to ${stayId} with appropriate video URL`);
    
  } catch (error) {
    console.error('Error handling passport request:', error);
    // Fallback to default message
    await sendDefaultMessage();
  }
}

/**
 * Example: Manual message generation for different room types
 */
function demonstrateVideoUrlSelection() {
  console.log('Video URL Examples:');
  console.log('==================');
  
  const testStayIds = [
    'BeachHouse_Smith',
    'JungleHouse_Johnson',
    'NewHouse_Brown',
    'A4_Wilson',
    'B7_Davis',
    'DoubleHouse_Garcia',
    'A4_New_House_Smith', // Multiple videos example
    'B7_Beach_House_Johnson' // Multiple videos example
  ];
  
  testStayIds.forEach(stayId => {
    const videos = getTourVideos(stayId);
    console.log(`${stayId} → ${videos.length} video(s):`);
    videos.forEach(video => console.log(`  ${video.label}: ${video.url}`));
    console.log('');
  });
}

/**
 * Demonstrate multiple video message generation
 */
function demonstrateMultipleVideoMessages() {
  console.log('\n=== Multiple Video Message Examples ===\n');
  
  const multiVideoStayIds = [
    'A4_New_House_Smith',
    'B7_Beach_House_Johnson',
    'A5_Beach_New_House_Family'
  ];
  
  multiVideoStayIds.forEach(stayId => {
    console.log(`--- ${stayId} ---`);
    console.log(generateVideoTourMessage(stayId));
    console.log('\n');
  });
}

/**
 * Example: Complete integration with WhatsApp Business API
 */
async function sendVideoTourToGuest(stayId, phoneNumber) {
  try {
    // Get the appropriate video URL
    const videoUrl = getTourVideoUrl(stayId);
    
    // Option 1: Send as a template message with dynamic video URL
    const templateMessage = {
      messaging_product: "whatsapp",
      to: phoneNumber,
      type: "template",
      template: {
        name: "video_tour_template", // Your WhatsApp template name
        language: {
          code: "en"
        },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "video",
                video: {
                  link: videoUrl
                }
              }
            ]
          },
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: stayId.split('_')[0] // Room name
              }
            ]
          }
        ]
      }
    };
    
    // Option 2: Send as regular text message
    const textMessage = {
      messaging_product: "whatsapp",
      to: phoneNumber,
      type: "text",
      text: {
        body: generateVideoTourMessage(stayId)
      }
    };
    
    // Choose which approach to use based on your WhatsApp setup
    return await sendToWhatsAppAPI(textMessage); // or templateMessage
    
  } catch (error) {
    console.error('Failed to send video tour message:', error);
    throw error;
  }
}

/**
 * Mock WhatsApp API function (replace with your actual implementation)
 */
async function sendWhatsAppMessage(groupId, message) {
  console.log(`Sending to group ${groupId}:`, message);
  // Your actual WhatsApp API call here
  // return await whatsappClient.sendMessage(groupId, message);
}

async function sendToWhatsAppAPI(messagePayload) {
  console.log('Sending to WhatsApp API:', JSON.stringify(messagePayload, null, 2));
  // Your actual WhatsApp Business API call here
  // return await fetch('https://graph.facebook.com/v17.0/YOUR_PHONE_NUMBER_ID/messages', {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
  //     'Content-Type': 'application/json'
  //   },
  //   body: JSON.stringify(messagePayload)
  // });
}

async function sendDefaultMessage() {
  console.log('Sending default video tour message');
  // Fallback implementation
}

// Example usage
if (require.main === module) {
  demonstrateVideoUrlSelection();
  demonstrateMultipleVideoMessages();
  
  // Simulate a WhatsApp group interaction
  const mockGroupInfo = {
    groupId: 'group_123',
    groupName: 'BeachHouse_Smith',
    description: 'Welcome to Coconut Beach! Register at https://coco-passport-proxy.vercel.app/register?stay_id=BeachHouse_Smith'
  };
  
  handlePassportRequestMessage(mockGroupInfo, 'Ready for passport photos!');
}

module.exports = {
  handlePassportRequestMessage,
  sendVideoTourToGuest,
  demonstrateVideoUrlSelection,
  demonstrateMultipleVideoMessages
};
