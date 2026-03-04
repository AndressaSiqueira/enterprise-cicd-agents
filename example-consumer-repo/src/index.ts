/**
 * Example Payments Service
 * 
 * This is a sample microservice that demonstrates how to integrate
 * with the Enterprise Governance SDK for CI/CD decisions.
 */

import express from 'express';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'payments' });
});

// Example endpoint
app.post('/api/payments/process', (req, res) => {
  const { amount, currency } = req.body;
  
  // Simulated payment processing
  res.json({
    transactionId: `txn_${Date.now()}`,
    amount,
    currency: currency || 'USD',
    status: 'processed',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`💳 Payments Service running on port ${PORT}`);
});

export default app;
