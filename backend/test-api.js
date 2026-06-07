import axios from 'axios';

const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('--- Starting API Integration Tests ---');
  
  try {
    // 1. Test registration
    console.log('Testing User Registration...');
    const regRes = await axios.post(`${BASE_URL}/auth/register`, {
      name: 'Integration Test User',
      email: `test-${Date.now()}@nexus.io`,
      password: 'password123',
      role: 'investor'
    });
    console.log('✓ Registration successful! Status:', regRes.status);
    const token = regRes.data.token;

    // Set token authorization header
    const headers = { Authorization: `Bearer ${token}` };

    // 2. Test Fetching own Profile
    console.log('Testing Profile Retrieval...');
    const profileRes = await axios.get(`${BASE_URL}/auth/me`, { headers });
    console.log('✓ Profile retrieved successfully! User Name:', profileRes.data.name);

    // 3. Test Wallet Deposit
    console.log('Testing Wallet Deposit...');
    const depositRes = await axios.post(`${BASE_URL}/payments/deposit`, { amount: 150000 }, { headers });
    console.log('✓ Deposit successful! New balance:', depositRes.data.balance);

    // 4. Test Wallet Withdrawal
    console.log('Testing Wallet Withdrawal...');
    const withdrawRes = await axios.post(`${BASE_URL}/payments/withdraw`, { amount: 5000 }, { headers });
    console.log('✓ Withdrawal successful! New balance:', withdrawRes.data.balance);

    console.log('\n--- All API Integration tests completed successfully! ---');
  } catch (error) {
    console.error('✖ Test Failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

runTests();
