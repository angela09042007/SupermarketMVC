const fetch = require('node-fetch');
require('dotenv').config();

const NETS_API = process.env.NETS_API || 'https://sandbox.nets.openapipaas.com';

function buildHeaders() {
  const apiKey = process.env.NETS_API_KEY;
  const projectId = process.env.NETS_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error('Missing NETS credentials (NETS_API_KEY or NETS_PROJECT_ID).');
  }
  return {
    'api-key': apiKey,
    'project-id': projectId,
    'Content-Type': 'application/json'
  };
}

async function requestQrCode(amount) {
  const response = await fetch(`${NETS_API}/api/v1/common/payments/nets-qr/request`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      txn_id: 'sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b',
      amt_in_dollars: amount,
      notify_mobile: 0
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`NETS request failed: ${response.status} ${text}`);
  }

  return await response.json();
}

async function queryPayment(txnRetrievalRef, frontendTimeoutStatus) {
  const response = await fetch(`${NETS_API}/api/v1/common/payments/nets-qr/query`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      txn_retrieval_ref: txnRetrievalRef,
      frontend_timeout_status: frontendTimeoutStatus
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`NETS query failed: ${response.status} ${text}`);
  }

  return await response.json();
}

module.exports = { requestQrCode, queryPayment };
