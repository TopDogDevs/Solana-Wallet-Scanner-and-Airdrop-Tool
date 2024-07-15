import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export async function getConnection(network: string): Promise<Connection> {
    const rpcUrl = network === 'mainnet'
        ? process.env.DEFAULT_MAINNET_RPC
        : process.env.DEFAULT_DEVNET_RPC;

    if (!rpcUrl) {
        throw new Error(`${network.toUpperCase()}_RPC not found in .env file`);
    }

    return new Connection(rpcUrl, 'confirmed');
}

export async function loadWalletKey(): Promise<Keypair> {
    const privateKeyBase58 = process.env.MAIN_WALLET_PRIVATE_KEY;
    if (!privateKeyBase58) {
        throw new Error('MAIN_WALLET_PRIVATE_KEY not found in .env file');
    }

    const privateKey = bs58.decode(privateKeyBase58);
    return Keypair.fromSecretKey(privateKey);
}
