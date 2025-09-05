const { 
  getTourVideoUrl, 
  getTourVideos,
  generateVideoTourMessage, 
  extractStayIdFromUrl,
  VIDEO_URLS 
} = require('../lib/videoUrlHelper');

describe('Video URL Helper', () => {
  
  describe('getTourVideoUrl', () => {
    test('should return Beach video URL for stay_ids containing "Beach"', () => {
      expect(getTourVideoUrl('BeachHouse_Smith')).toBe(VIDEO_URLS.BEACH);
      expect(getTourVideoUrl('beach_house_johnson')).toBe(VIDEO_URLS.BEACH);
      expect(getTourVideoUrl('BEACHHOUSE_BROWN')).toBe(VIDEO_URLS.BEACH);
      expect(getTourVideoUrl('SomeBeachVilla_Garcia')).toBe(VIDEO_URLS.BEACH);
    });

    test('should return Jungle video URL for stay_ids containing "Jungle"', () => {
      expect(getTourVideoUrl('JungleHouse_Wilson')).toBe(VIDEO_URLS.JUNGLE);
      expect(getTourVideoUrl('jungle_house_taylor')).toBe(VIDEO_URLS.JUNGLE);
      expect(getTourVideoUrl('JUNGLEHOUSE_DAVIS')).toBe(VIDEO_URLS.JUNGLE);
      expect(getTourVideoUrl('MyJungleCabin_Miller')).toBe(VIDEO_URLS.JUNGLE);
    });

    test('should return New video URL for stay_ids containing "New"', () => {
      expect(getTourVideoUrl('NewHouse_Anderson')).toBe(VIDEO_URLS.NEW);
      expect(getTourVideoUrl('new_house_thomas')).toBe(VIDEO_URLS.NEW);
      expect(getTourVideoUrl('NEWHOUSE_JACKSON')).toBe(VIDEO_URLS.NEW);
      expect(getTourVideoUrl('BrandNewPlace_White')).toBe(VIDEO_URLS.NEW);
    });

    test('should return default video URL for other stay_ids', () => {
      expect(getTourVideoUrl('A4_Smith')).toBe(VIDEO_URLS.DEFAULT);
      expect(getTourVideoUrl('B7_Johnson')).toBe(VIDEO_URLS.DEFAULT);
      expect(getTourVideoUrl('DoubleHouse_Brown')).toBe(VIDEO_URLS.DEFAULT);
      expect(getTourVideoUrl('A3_Wilson')).toBe(VIDEO_URLS.DEFAULT);
      expect(getTourVideoUrl('B9_Taylor')).toBe(VIDEO_URLS.DEFAULT);
    });

    test('should return default video URL for invalid inputs', () => {
      expect(getTourVideoUrl('')).toBe(VIDEO_URLS.DEFAULT);
      expect(getTourVideoUrl(null)).toBe(VIDEO_URLS.DEFAULT);
      expect(getTourVideoUrl(undefined)).toBe(VIDEO_URLS.DEFAULT);
      expect(getTourVideoUrl(123)).toBe(VIDEO_URLS.DEFAULT);
    });

    test('should handle mixed case and partial matches correctly', () => {
      expect(getTourVideoUrl('MixedBeachCabin_Test')).toBe(VIDEO_URLS.BEACH);
      expect(getTourVideoUrl('SuperJungleVilla_Test')).toBe(VIDEO_URLS.JUNGLE);
      expect(getTourVideoUrl('TheNewPlace_Test')).toBe(VIDEO_URLS.NEW);
    });

    test('should prioritize first match if multiple keywords present', () => {
      // Beach comes first in the if-else chain
      expect(getTourVideoUrl('BeachJungleHouse_Test')).toBe(VIDEO_URLS.BEACH);
      expect(getTourVideoUrl('BeachNewPlace_Test')).toBe(VIDEO_URLS.BEACH);
      // Jungle comes second
      expect(getTourVideoUrl('JungleNewHouse_Test')).toBe(VIDEO_URLS.JUNGLE);
    });
  });

  describe('generateVideoTourMessage', () => {
    test('should generate message with Beach video URL', () => {
      const message = generateVideoTourMessage('BeachHouse_Smith');
      expect(message).toContain(VIDEO_URLS.BEACH);
      expect(message).toContain('Perfect!.. Final step is a video tour');
      expect(message).toContain('passport photos');
      expect(message).toContain('ferry details');
      expect(message).toContain('500 THB');
    });

    test('should generate message with Jungle video URL', () => {
      const message = generateVideoTourMessage('JungleHouse_Johnson');
      expect(message).toContain(VIDEO_URLS.JUNGLE);
      expect(message).toContain('Perfect!.. Final step is a video tour');
    });

    test('should generate message with New video URL', () => {
      const message = generateVideoTourMessage('NewHouse_Brown');
      expect(message).toContain(VIDEO_URLS.NEW);
      expect(message).toContain('Perfect!.. Final step is a video tour');
    });

    test('should generate message with default video URL', () => {
      const message = generateVideoTourMessage('A4_Wilson');
      expect(message).toContain(VIDEO_URLS.DEFAULT);
      expect(message).toContain('Perfect!.. Final step is a video tour');
    });

    test('should handle invalid stay_id gracefully', () => {
      const message = generateVideoTourMessage(null);
      expect(message).toContain(VIDEO_URLS.DEFAULT);
      expect(message).toContain('Perfect!.. Final step is a video tour');
    });
  });

  describe('extractStayIdFromUrl', () => {
    test('should extract stay_id from query parameter', () => {
      const url1 = 'https://coco-passport-proxy.vercel.app/register?stay_id=BeachHouse_Smith';
      expect(extractStayIdFromUrl(url1)).toBe('BeachHouse_Smith');

      const url2 = 'https://example.com/form?other=value&stay_id=A4_Johnson&another=param';
      expect(extractStayIdFromUrl(url2)).toBe('A4_Johnson');
    });

    test('should extract stay_id from URL path', () => {
      const url1 = 'https://coco-passport-proxy.vercel.app/register/JungleHouse_Brown';
      expect(extractStayIdFromUrl(url1)).toBe('JungleHouse_Brown');

      const url2 = 'https://example.com/booking/A4_Wilson/confirm';
      expect(extractStayIdFromUrl(url2)).toBe('A4_Wilson');
    });

    test('should handle URL-encoded stay_id', () => {
      const url = 'https://example.com/register?stay_id=Beach%20House_Smith%20Family';
      expect(extractStayIdFromUrl(url)).toBe('Beach House_Smith Family');
    });

    test('should return null for invalid inputs', () => {
      expect(extractStayIdFromUrl('')).toBeNull();
      expect(extractStayIdFromUrl(null)).toBeNull();
      expect(extractStayIdFromUrl(undefined)).toBeNull();
      expect(extractStayIdFromUrl(123)).toBeNull();
    });

    test('should return null if no stay_id found', () => {
      const url = 'https://example.com/register?other=value&another=param';
      expect(extractStayIdFromUrl(url)).toBeNull();
    });

    test('should handle case-insensitive stay_id parameter', () => {
      const url = 'https://example.com/register?STAY_ID=BeachHouse_Test';
      expect(extractStayIdFromUrl(url)).toBe('BeachHouse_Test');
    });
  });

  describe('getTourVideos', () => {
    test('should return single video for simple room types', () => {
      const beachVideos = getTourVideos('BeachHouse_Smith');
      expect(beachVideos).toEqual([{ label: 'Beach House', url: VIDEO_URLS.BEACH }]);
      
      const jungleVideos = getTourVideos('JungleHouse_Johnson');
      expect(jungleVideos).toEqual([{ label: 'Jungle House', url: VIDEO_URLS.JUNGLE }]);
      
      const newVideos = getTourVideos('NewHouse_Brown');
      expect(newVideos).toEqual([{ label: 'New House', url: VIDEO_URLS.NEW }]);
    });

    test('should return single video for numbered rooms', () => {
      const a4Videos = getTourVideos('A4_Smith');
      expect(a4Videos).toEqual([{ label: 'A4', url: VIDEO_URLS.DEFAULT }]);
      
      const b7Videos = getTourVideos('B7_Johnson');
      expect(b7Videos).toEqual([{ label: 'B7', url: VIDEO_URLS.DEFAULT }]);
      
      const doubleVideos = getTourVideos('DoubleHouse_Brown');
      expect(doubleVideos).toEqual([{ label: 'Double House', url: VIDEO_URLS.DEFAULT }]);
    });

    test('should return multiple videos for combined room types', () => {
      const a4NewVideos = getTourVideos('A4_New_House_Smith');
      expect(a4NewVideos).toHaveLength(2);
      expect(a4NewVideos).toContainEqual({ label: 'A4', url: VIDEO_URLS.DEFAULT });
      expect(a4NewVideos).toContainEqual({ label: 'New House', url: VIDEO_URLS.NEW });
      
      const b7BeachVideos = getTourVideos('B7_Beach_House_Johnson');
      expect(b7BeachVideos).toHaveLength(2);
      expect(b7BeachVideos).toContainEqual({ label: 'B7', url: VIDEO_URLS.DEFAULT });
      expect(b7BeachVideos).toContainEqual({ label: 'Beach House', url: VIDEO_URLS.BEACH });
    });

    test('should handle triple combinations', () => {
      const tripleVideos = getTourVideos('A5_Beach_New_House_Family');
      expect(tripleVideos).toHaveLength(3);
      expect(tripleVideos).toContainEqual({ label: 'A5', url: VIDEO_URLS.DEFAULT });
      expect(tripleVideos).toContainEqual({ label: 'Beach House', url: VIDEO_URLS.BEACH });
      expect(tripleVideos).toContainEqual({ label: 'New House', url: VIDEO_URLS.NEW });
    });

    test('should handle case-insensitive matching', () => {
      const mixedCaseVideos = getTourVideos('a4_new_house_smith');
      expect(mixedCaseVideos).toHaveLength(2);
      expect(mixedCaseVideos).toContainEqual({ label: 'A4', url: VIDEO_URLS.DEFAULT });
      expect(mixedCaseVideos).toContainEqual({ label: 'New House', url: VIDEO_URLS.NEW });
    });

    test('should return default for invalid inputs', () => {
      expect(getTourVideos('')).toEqual([{ label: 'Your Bungalow', url: VIDEO_URLS.DEFAULT }]);
      expect(getTourVideos(null)).toEqual([{ label: 'Your Bungalow', url: VIDEO_URLS.DEFAULT }]);
      expect(getTourVideos(undefined)).toEqual([{ label: 'Your Bungalow', url: VIDEO_URLS.DEFAULT }]);
    });

    test('should return default for unrecognized room types', () => {
      const unknownVideos = getTourVideos('UnknownRoom_Smith');
      expect(unknownVideos).toEqual([{ label: 'Your Bungalow', url: VIDEO_URLS.DEFAULT }]);
    });
  });

  describe('generateVideoTourMessage - Multiple Videos', () => {
    test('should generate single video message format for simple rooms', () => {
      const message = generateVideoTourMessage('BeachHouse_Smith');
      expect(message).toContain('Perfect!.. Final step is a video tour');
      expect(message).toContain(VIDEO_URLS.BEACH);
      expect(message).not.toContain('Beach House -'); // Should not have label format
    });

    test('should generate multiple video message format for combined rooms', () => {
      const message = generateVideoTourMessage('A4_New_House_Smith');
      expect(message).toContain('Perfect!.. Final step is a video tour');
      expect(message).toContain('A4 - https://youtu.be/EsmqwgqyKI4');
      expect(message).toContain('New House - https://youtu.be/yCgEuyLapmc');
      expect(message).toContain('ferry details');
    });

    test('should format multiple videos correctly', () => {
      const message = generateVideoTourMessage('B7_Beach_House_Johnson');
      const lines = message.split('\n');
      
      // Find the video section
      const videoSectionStart = lines.findIndex(line => line.includes('B7 -'));
      expect(videoSectionStart).toBeGreaterThan(-1);
      
      expect(lines[videoSectionStart]).toBe('B7 - https://youtu.be/EsmqwgqyKI4');
      expect(lines[videoSectionStart + 1]).toBe('Beach House - https://www.youtube.com/watch?v=TfD5ZHq53jE');
    });
  });

  describe('VIDEO_URLS constants', () => {
    test('should have all required video URLs defined', () => {
      expect(VIDEO_URLS.BEACH).toBe('https://www.youtube.com/watch?v=TfD5ZHq53jE');
      expect(VIDEO_URLS.JUNGLE).toBe('https://youtu.be/b15Vj5_3Tuc');
      expect(VIDEO_URLS.NEW).toBe('https://youtu.be/yCgEuyLapmc');
      expect(VIDEO_URLS.DEFAULT).toBe('https://youtu.be/EsmqwgqyKI4');
    });

    test('should have valid YouTube URLs', () => {
      Object.values(VIDEO_URLS).forEach(url => {
        expect(url).toMatch(/^https:\/\/(www\.)?youtu(\.be|be\.com)/);
      });
    });
  });
});
