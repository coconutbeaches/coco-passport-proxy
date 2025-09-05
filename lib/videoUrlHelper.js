/**
 * Video URL Helper for Coconut Beach Bungalows
 * Determines the correct video tour URL based on the stay_id room type
 */

// Video URLs for different room types
const VIDEO_URLS = {
  BEACH: 'https://www.youtube.com/watch?v=TfD5ZHq53jE',
  JUNGLE: 'https://youtu.be/b15Vj5_3Tuc',
  NEW: 'https://youtu.be/yCgEuyLapmc',
  DEFAULT: 'https://youtu.be/EsmqwgqyKI4' // For A3, A4, A5, A6, A7, A8, A9, B6, B7, B8, B9, Double House
};

/**
 * Get all applicable video tour URLs and labels based on stay_id
 * @param {string} stayId - The stay ID (e.g., "A4_New_House_Smith", "BeachHouse_Johnson")
 * @returns {Array} Array of {label, url} objects for all matching room types
 */
function getTourVideos(stayId) {
  if (!stayId || typeof stayId !== 'string') {
    return [{ label: 'Your Bungalow', url: VIDEO_URLS.DEFAULT }];
  }

  const stayIdUpper = stayId.toUpperCase();
  const videos = [];
  
  // Check for specific room numbers (A3-A9, B6-B9)
  const roomMatch = stayIdUpper.match(/(^|_)(A[3-9]|B[6-9])(_|$)/);
  if (roomMatch) {
    const roomNumber = roomMatch[2]; // The room number is in the second capture group
    videos.push({ 
      label: roomNumber, 
      url: VIDEO_URLS.DEFAULT 
    });
  }
  
  // Check for Double House separately
  if (stayIdUpper.includes('DOUBLE')) {
    videos.push({ 
      label: 'Double House', 
      url: VIDEO_URLS.DEFAULT 
    });
  }
  
  // Check for special room types
  if (stayIdUpper.includes('BEACH')) {
    videos.push({ label: 'Beach House', url: VIDEO_URLS.BEACH });
  }
  if (stayIdUpper.includes('JUNGLE')) {
    videos.push({ label: 'Jungle House', url: VIDEO_URLS.JUNGLE });
  }
  if (stayIdUpper.includes('NEW')) {
    videos.push({ label: 'New House', url: VIDEO_URLS.NEW });
  }
  
  // If no specific matches found, return default
  if (videos.length === 0) {
    videos.push({ label: 'Your Bungalow', url: VIDEO_URLS.DEFAULT });
  }
  
  return videos;
}

/**
 * Get the appropriate video tour URL based on stay_id (legacy function for backward compatibility)
 * @param {string} stayId - The stay ID (e.g., "BeachHouse_Smith", "A4_Johnson", "JungleHouse_Brown")
 * @returns {string} The appropriate YouTube video URL (returns first match if multiple)
 */
function getTourVideoUrl(stayId) {
  const videos = getTourVideos(stayId);
  return videos[0].url;
}

/**
 * Generate the complete WhatsApp message with the appropriate video URL(s)
 * @param {string} stayId - The stay ID from the registration URL
 * @returns {string} The complete message text with the correct video URL(s)
 */
function generateVideoTourMessage(stayId) {
  const videos = getTourVideos(stayId);
  
  let videoSection;
  if (videos.length === 1) {
    // Single video - show just the URL
    videoSection = videos[0].url;
  } else {
    // Multiple videos - show labeled list
    videoSection = videos.map(video => `${video.label} - ${video.url}`).join('\n');
  }
  
  return `Perfect!.. Final step is a video tour of your bungalow. Please have a watch, and when finished, reply here with your passport photos.

${videoSection}

By the way, if you send a photo of your ferry details we pick up guests at the main pier in Thong Sala for 500 THB total, or Baan Tai pier for 750, or Haad Rin pier for 1,000`;
}

/**
 * Extract stay_id from a registration URL
 * @param {string} url - The registration URL from WhatsApp group description
 * @returns {string|null} The extracted stay_id or null if not found
 */
function extractStayIdFromUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  
  // Look for stay_id parameter in the URL
  const stayIdMatch = url.match(/[?&]stay_id=([^&]*)/i);
  if (stayIdMatch && stayIdMatch[1]) {
    return decodeURIComponent(stayIdMatch[1]);
  }
  
  // Alternative patterns if the stay_id is in the path
  const pathMatch = url.match(/\/([A-Za-z0-9_]+(?:House)?_[A-Za-z0-9_]+)(?:[/?&]|$)/);
  if (pathMatch && pathMatch[1]) {
    return pathMatch[1];
  }
  
  return null;
}

module.exports = {
  getTourVideoUrl,
  getTourVideos,
  generateVideoTourMessage,
  extractStayIdFromUrl,
  VIDEO_URLS
};
