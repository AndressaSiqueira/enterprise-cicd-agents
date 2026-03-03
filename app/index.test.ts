import { EnterpriseService, createService } from './index.js';

describe('EnterpriseService', () => {
  let service: EnterpriseService;

  beforeEach(() => {
    service = createService('test-service', '1.0.0', 'development');
  });

  describe('getConfig', () => {
    it('should return service configuration', () => {
      const config = service.getConfig();
      
      expect(config.name).toBe('test-service');
      expect(config.version).toBe('1.0.0');
      expect(config.environment).toBe('development');
    });

    it('should return a copy of config (immutability)', () => {
      const config1 = service.getConfig();
      const config2 = service.getConfig();
      
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when all checks pass', () => {
      const result = service.healthCheck();
      
      expect(result.status).toBe('healthy');
      expect(result.version).toBe('1.0.0');
      expect(result.checks.memory).toBe(true);
      expect(result.checks.uptime).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    it('should include ISO timestamp', () => {
      const result = service.healthCheck();
      const parsedDate = new Date(result.timestamp);
      
      expect(parsedDate.toISOString()).toBe(result.timestamp);
    });
  });

  describe('getUptime', () => {
    it('should return positive uptime', () => {
      const uptime = service.getUptime();
      
      expect(uptime).toBeGreaterThanOrEqual(0);
    });

    it('should increase over time', async () => {
      const uptime1 = service.getUptime();
      await new Promise(resolve => setTimeout(resolve, 10));
      const uptime2 = service.getUptime();
      
      expect(uptime2).toBeGreaterThan(uptime1);
    });
  });

  describe('processRequest', () => {
    it('should process request successfully', () => {
      const result = service.processRequest({ message: 'hello' });
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ message: 'hello' });
      expect(result.requestId).toMatch(/^req_/);
      expect(result.error).toBeUndefined();
    });

    it('should generate unique request IDs', () => {
      const result1 = service.processRequest({});
      const result2 = service.processRequest({});
      
      expect(result1.requestId).not.toBe(result2.requestId);
    });
  });

  describe('validateEnvironment', () => {
    it('should validate development environment', () => {
      const devService = createService('test', '1.0.0', 'development');
      const result = devService.validateEnvironment();
      
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should report issues for production without NODE_ENV', () => {
      const originalEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
      
      const prodService = createService('test', '1.0.0', 'production');
      const result = prodService.validateEnvironment();
      
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('NODE_ENV should be set to production');
      
      process.env.NODE_ENV = originalEnv;
    });
  });
});

describe('createService factory', () => {
  it('should create service with defaults', () => {
    const service = createService();
    const config = service.getConfig();
    
    expect(config.name).toBe('enterprise-api');
    expect(config.version).toBe('1.0.0');
    expect(config.environment).toBe('development');
  });

  it('should create service with custom parameters', () => {
    const service = createService('custom', '2.0.0', 'staging');
    const config = service.getConfig();
    
    expect(config.name).toBe('custom');
    expect(config.version).toBe('2.0.0');
    expect(config.environment).toBe('staging');
  });
});
