import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';
import fs from 'fs-extra';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;
const RPC_URL = process.env.RPC_URL || null;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || null;
const JWT_SECRET = process.env.JWT_SECRET || 'very-secret-demo-key';
const NONCE_EXPIRY_MS = process.env.NONCE_EXPIRY_MS ? Number(process.env.NONCE_EXPIRY_MS) : 5 * 60 * 1000;

const NONCES_FILE = './nonces.json';
if (!fs.existsSync(NONCES_FILE)) fs.writeJSONSync(NONCES_FILE, {});

function loadNonces() { return fs.readJSONSync(NONCES_FILE); }
function saveNonces(data) { fs.writeJSONSync(NONCES_FILE, data, { spaces: 2 }); }

const CONTRACT_ABI = [
  "function isIssuer(address who) external view returns (bool)"
];

const provider = RPC_URL ? new ethers.JsonRpcProvider(RPC_URL) : null;
const contract = (provider && CONTRACT_ADDRESS) ? new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider) : null;

app.get('/', (req, res) => res.send('Issuer auth backend (demo)'));

app.get('/api/nonce', (req, res) => {
  const address = (req.query.address || '').toLowerCase();
  if (!address || !ethers.isAddress(address)) return res.status(400).json({ error: 'invalid address' });
  const nonces = loadNonces();
  const payload = `SkillsPassport login: ${Math.floor(Math.random() * 1e9)}|${Date.now()}`;
  nonces[address] = { nonce: payload, createdAt: Date.now() };
  saveNonces(nonces);
  res.json({ nonce: payload });
});

app.post('/api/auth/wallet', async (req, res) => {
  try {
    const { address, signature } = req.body;
    if (!address || !signature) return res.status(400).json({ error: 'address & signature required' });

    const nonces = loadNonces();
    const entry = nonces[address.toLowerCase()];
    if (!entry) return res.status(400).json({ error: 'nonce not found. request /api/nonce first' });

    if (Date.now() - entry.createdAt > NONCE_EXPIRY_MS) {
      delete nonces[address.toLowerCase()];
      saveNonces(nonces);
      return res.status(400).json({ error: 'nonce expired. request a new one' });
    }

    let recovered;
    try {
      recovered = ethers.verifyMessage(entry.nonce, signature);
    } catch (e) {
      return res.status(400).json({ error: 'invalid signature' });
    }

    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return res.status(400).json({ error: 'signature does not match address' });
    }

    if (!contract) {
      return res.status(500).json({ error: 'on-chain provider or contract not configured on server' });
    }

    try {
      const isOnchain = await contract.isIssuer(address);
      if (!isOnchain) {
        return res.status(403).json({ error: 'address is not a registered issuer on-chain' });
      }
    } catch (err) {
      console.error('on-chain check error', err);
      return res.status(500).json({ error: 'on-chain verification failed' });
    }

    // success: issue JWT
    const token = jwt.sign({ address: address.toLowerCase() }, JWT_SECRET, { expiresIn: '6h' });

    // consume nonce
    delete nonces[address.toLowerCase()];
    saveNonces(nonces);

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return res.json({ address: payload.address });
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
});

app.listen(PORT, () => {
  console.log(`Issuer auth backend listening on http://localhost:${PORT}`);
  if (!RPC_URL || !CONTRACT_ADDRESS) console.warn('Warning: RPC_URL or CONTRACT_ADDRESS not set — on-chain checks will fail.');
});
