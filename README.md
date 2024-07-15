Solana Wallet Scanner and Airdrop Tool

```markdown
# Solana Token Scanner and Transfer Tool

This is a command-line tool for scanning Solana tokens and SOL balances, and transferring tokens to multiple wallets. It supports both mainnet and devnet networks.

## Features

- Scan and display SOL balance and token balances
- Transfer SOL or tokens to multiple wallets
- Support for child wallets and public key addresses
- Even or random distribution of tokens
- Option to choose fee payer (main wallet or recipient wallets)
- Detailed transaction summaries and error handling

## Prerequisites

- Node.js (v14 or later recommended)
- npm (comes with Node.js)

## Installation

1. Clone this repository:
```

git clone https://github.com/yourusername/solana-token-scanner.git
cd solana-token-scanner

```

2. Install dependencies:
```

npm install

```

3. Create a `.env` file in the root directory with the following content:
```

DEFAULT_MAINNET_RPC=https://api.mainnet-beta.solana.com
DEFAULT_DEVNET_RPC=https://api.devnet.solana.com
MAIN_WALLET_PRIVATE_KEY=your_private_key_here

```
Replace `your_private_key_here` with your actual private key.

## Usage

Run the program with:

```

npm start

```

Follow the prompts to:
1. Select the network (mainnet or devnet)
2. View your token balances
3. Choose to send tokens to child wallets or airdrop to public keys
4. Select the token to send
5. Specify the amount and number of recipient wallets
6. Choose distribution method (even or random)
7. Select fee payer (main wallet or recipient wallets)

## Configuration

- `config.ts`: Contains functions for setting up the Solana connection and loading the wallet key.
- `data.json`: Stores information about child wallets. This file is created and updated automatically.

## Security

- Never share your `.env` file or private keys.
- This tool is for educational and development purposes. Use on mainnet at your own risk.

## Dependencies

- @solana/web3.js
- @solana/spl-token
- @metaplex-foundation/js
- dotenv
- chalk
- inquirer
- table

## License

This project is open source and available under the [MIT License](LICENSE).
```
