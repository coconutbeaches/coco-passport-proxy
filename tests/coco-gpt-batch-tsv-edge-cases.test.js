const request = require('supertest');
const handler = require('../index');

// Mock environment variables
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

// Mock fetch for Supabase calls
global.fetch = jest.fn();

describe('/coco-gpt-batch-tsv Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 1 }, { id: 2 }]
    });
  });

  describe('Non-ASCII names', () => {
    it('should handle UTF-8 characters in names', async () => {
      const tsvData = "José\tMaría\tGarcía\tM\tP123456\tESP\t15/03/1990\t2024-01-15\nÄnna\t\tMüller\tF\tD789012\tDEU\t22/12/1985\t";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_TestGuest',
          default_checkout: '2024-01-20',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.inserted).toBe(2);
    });

    it('should handle Chinese characters', async () => {
      const tsvData = "王\t小\t明\tM\tC123456\tCHN\t08/05/1992\t2024-01-15";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_Chinese',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
    });
  });

  describe('Blank middle names', () => {
    it('should handle empty middle name columns', async () => {
      const tsvData = "John\t\tDoe\tM\tP123456\tUSA\t11/06/1985\t2024-01-14";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_NoMiddle',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"middle_name":null')
        })
      );
    });

    it('should handle whitespace-only middle names', async () => {
      const tsvData = "John\t   \tDoe\tM\tP123456\tUSA\t11/06/1985\t2024-01-14";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_WhitespaceMiddle',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"middle_name":null')
        })
      );
    });
  });

  describe('Natural date formats in default_checkout', () => {
    it('should handle "Sept 11" format', async () => {
      const tsvData = "John\tM\tDoe\tM\tP123456\tUSA\t11/06/1985\t";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_NaturalDate',
          default_checkout: 'Sept 11',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(200);
    });

    it('should handle "11 September 2025" format', async () => {
      const tsvData = "John\tM\tDoe\tM\tP123456\tUSA\t11/06/1985\t";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_LongDate',
          default_checkout: '11 September 2025',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(200);
    });

    it('should handle ISO format dates', async () => {
      const tsvData = "John\tM\tDoe\tM\tP123456\tUSA\t11/06/1985\t";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_ISO',
          default_checkout: '2025-09-11',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(200);
    });
  });

  describe('Mixed newline styles', () => {
    it('should handle \\n newlines', async () => {
      const tsvData = "John\tM\tDoe\tM\tP123456\tUSA\t11/06/1985\t2024-01-14\nJane\t\tSmith\tF\tP789012\tGBR\t25/12/1990\t";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_UnixNewlines',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(200);
      expect(response.body.inserted).toBe(2);
    });

    it('should handle \\r\\n newlines', async () => {
      const tsvData = "John\tM\tDoe\tM\tP123456\tUSA\t11/06/1985\t2024-01-14\r\nJane\t\tSmith\tF\tP789012\tGBR\t25/12/1990\t";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_WindowsNewlines',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(200);
      expect(response.body.inserted).toBe(2);
    });

    it('should handle mixed newline styles', async () => {
      const tsvData = "John\tM\tDoe\tM\tP123456\tUSA\t11/06/1985\t2024-01-14\nJane\t\tSmith\tF\tP789012\tGBR\t25/12/1990\t\r\nBob\t\tJohnson\tM\tP345678\tCAN\t01/01/1980\t";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_MixedNewlines',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(200);
      expect(response.body.inserted).toBe(3);
    });
  });

  describe('Weird spacing around tabs', () => {
    it('should handle extra spaces around tabs', async () => {
      const tsvData = "John \t M \t Doe \t M \t P123456 \t USA \t 11/06/1985 \t 2024-01-14";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_SpacedTabs',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringMatching(/"first_name":"John".*"middle_name":"M".*"last_name":"Doe"/)
        })
      );
    });

    it('should handle tabs with no spaces', async () => {
      const tsvData = "John\tM\tDoe\tM\tP123456\tUSA\t11/06/1985\t2024-01-14";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_CleanTabs',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(200);
    });

    it('should handle multiple consecutive tabs', async () => {
      const tsvData = "John\t\t\tDoe\tM\tP123456\tUSA\t11/06/1985\t2024-01-14";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_MultipleTabs',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(200);
    });
  });

  describe('Size and abuse limits', () => {
    it('should reject payloads over 1MB', async () => {
      const largePayload = 'a'.repeat(1024 * 1024 + 1);
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .set('Content-Length', (1024 * 1024 + 1).toString())
        .send({
          stay_id: 'A4_Large',
          guests_tsv: largePayload
        });

      expect(response.status).toBe(413);
      expect(response.body.ok).toBe(false);
      expect(response.body.error).toContain('Payload too large');
    });

    it('should reject more than 50 lines', async () => {
      const manyLines = Array(51).fill("John\tM\tDoe\tM\tP123456\tUSA\t11/06/1985\t2024-01-14").join('\n');
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_TooManyLines',
          guests_tsv: manyLines
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Too many lines in TSV');
    });
  });

  describe('Strict validation', () => {
    it('should reject invalid gender codes', async () => {
      const tsvData = "John\tM\tDoe\tInvalid\tP123456\tUSA\t11/06/1985\t2024-01-14";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_InvalidGender',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Invalid gender');
    });

    it('should reject invalid nationality codes', async () => {
      const tsvData = "John\tM\tDoe\tM\tP123456\tTOOLONG\t11/06/1985\t2024-01-14";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_InvalidNationality',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Invalid nationality_alpha3');
    });

    it('should reject malformed dates', async () => {
      const tsvData = "John\tM\tDoe\tM\tP123456\tUSA\tinvalid-date\t2024-01-14";
      
      const response = await request(handler)
        .post('/coco-gpt-batch-tsv')
        .send({
          stay_id: 'A4_InvalidDate',
          guests_tsv: tsvData
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Invalid birthday format');
    });
  });

  describe('Gender normalization edge cases', () => {
    it('should normalize various gender formats', async () => {
      const testCases = [
        ["male", "M"],
        ["female", "F"],
        ["MALE", "M"],
        ["FEMALE", "F"],
        ["m", "M"],
        ["f", "F"],
        ["nb", "X"],
        ["nonbinary", "X"],
        ["other", "X"],
        ["x", "X"]
      ];

      for (const [input, expected] of testCases) {
        const tsvData = `John\tM\tDoe\t${input}\tP123456\tUSA\t11/06/1985\t2024-01-14`;
        
        const response = await request(handler)
          .post('/coco-gpt-batch-tsv')
          .send({
            stay_id: `A4_Gender${input}`,
            guests_tsv: tsvData
          });

        expect(response.status).toBe(200);
        expect(fetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining(`"gender":"${expected}"`)
          })
        );
      }
    });
  });
});
