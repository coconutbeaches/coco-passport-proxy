// Global test setup
jest.setTimeout(30000); // 30 second timeout for tests

// Mock console methods to reduce noise during tests
const originalConsoleError = console.error;
const originalConsoleLog = console.log;

beforeAll(() => {
  // Mock console.error to suppress expected error messages during tests
  console.error = jest.fn();
  console.log = jest.fn();
});

afterAll(() => {
  // Restore original console methods
  console.error = originalConsoleError;
  console.log = originalConsoleLog;
});

// Clean up environment variables after each test
afterEach(() => {
  // Reset environment variables to clean state
  process.env.SKIP_UPLOADS = '1';
});
