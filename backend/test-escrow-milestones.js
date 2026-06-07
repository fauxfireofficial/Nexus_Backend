import axios from 'axios';

const BASE_URL = 'http://localhost:5000/api';

async function runEscrowTests() {
  console.log('--- Starting Escrow & Milestones Integration Tests ---');
  
  try {
    const timestamp = Date.now();
    
    // 1. Register Investor
    console.log('Registering Investor...');
    const investorReg = await axios.post(`${BASE_URL}/auth/register`, {
      name: 'Test Investor',
      email: `investor-${timestamp}@nexus.io`,
      password: 'password123',
      role: 'investor'
    });
    const investorToken = investorReg.data.token;
    const investorHeaders = { Authorization: `Bearer ${investorToken}` };
    console.log('✓ Investor registered.');

    // 2. Deposit funds to Investor wallet
    console.log('Depositing $20,000 into Investor wallet...');
    const depRes = await axios.post(`${BASE_URL}/payments/deposit`, { amount: 20000 }, { headers: investorHeaders });
    console.log('✓ Deposit successful. Investor wallet balance:', depRes.data.balance);

    // 3. Register Entrepreneur (Startup)
    console.log('Registering Entrepreneur...');
    const entrepreneurReg = await axios.post(`${BASE_URL}/auth/register`, {
      name: 'Test Entrepreneur',
      email: `entrepreneur-${timestamp}@nexus.io`,
      password: 'password123',
      role: 'entrepreneur',
      startupName: 'Nexus Tech'
    });
    const entrepreneurId = entrepreneurReg.data.user.id;
    const entrepreneurToken = entrepreneurReg.data.token;
    const entrepreneurHeaders = { Authorization: `Bearer ${entrepreneurToken}` };
    console.log('✓ Entrepreneur registered. ID:', entrepreneurId);

    // 4. Test Escrow Transfer
    console.log('\nTesting Escrow Transfer from Investor to Entrepreneur...');
    const escrowTx = await axios.post(`${BASE_URL}/payments/transfer`, {
      recipientId: entrepreneurId,
      amount: 5000,
      isEscrow: true,
      agreementAccepted: true,
      milestoneTitle: 'Prototype Development'
    }, { headers: investorHeaders });

    const milestoneId = escrowTx.data.milestone.id;
    console.log('✓ Escrow Transfer successful!');
    console.log('  Investor balance after hold:', escrowTx.data.balance);
    console.log('  Milestone status:', escrowTx.data.milestone.status);
    console.log('  Milestone ID:', milestoneId);

    // Verify entrepreneur's balance is unchanged (still 0) because funds are held in escrow
    const startupProfileBefore = await axios.get(`${BASE_URL}/auth/me`, { headers: entrepreneurHeaders });
    console.log('  Startup wallet balance (should be 0):', startupProfileBefore.data.walletBalance);

    // 5. Test Startup marking milestone as completed
    console.log('\nEntrepreneur marking milestone as completed...');
    const completeRes = await axios.put(`${BASE_URL}/milestones/${milestoneId}/complete`, {}, { headers: entrepreneurHeaders });
    console.log('✓ Milestone completed! Current status:', completeRes.data.status);

    // 6. Test Investor releasing escrow funds
    console.log('\nInvestor releasing escrow funds for completed milestone...');
    const releaseRes = await axios.post(`${BASE_URL}/milestones/${milestoneId}/release`, {}, { headers: investorHeaders });
    console.log('✓ Escrow released! Investor balance:', releaseRes.data.balance);
    console.log('  Milestone status:', releaseRes.data.milestone.status);

    // Verify entrepreneur's balance is now credited ($5000)
    const startupProfileAfter = await axios.get(`${BASE_URL}/auth/me`, { headers: entrepreneurHeaders });
    console.log('  Startup wallet balance after release (should be 5000):', startupProfileAfter.data.walletBalance);

    // 7. Test Entrepreneur proposing an independent milestone
    console.log('\nEntrepreneur proposing an independent roadmap milestone...');
    const proposeRes = await axios.post(`${BASE_URL}/milestones`, {
      title: 'Marketing Campaign',
      description: 'Run social media ads for product launch',
      targetAmount: 3000,
      deadline: new Date(Date.now() + 86400000 * 30).toISOString() // 30 days later
    }, { headers: entrepreneurHeaders });
    const proposedMilestoneId = proposeRes.data.id;
    console.log('✓ Milestone proposed! ID:', proposedMilestoneId, 'Status:', proposeRes.data.status);

    // 8. Test Investor funding the proposed milestone via escrow
    console.log('\nInvestor funding the proposed milestone...');
    const fundRes = await axios.post(`${BASE_URL}/milestones/${proposedMilestoneId}/fund`, {
      agreementAccepted: true
    }, { headers: investorHeaders });
    console.log('✓ Proposed Milestone funded!');
    console.log('  Investor balance after funding proposed:', fundRes.data.balance);
    console.log('  Milestone status (should be in_progress):', fundRes.data.milestone.status);

    console.log('\n--- All Escrow & Milestone tests completed successfully! ---');
  } catch (error) {
    console.error('✖ Test Failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

runEscrowTests();
