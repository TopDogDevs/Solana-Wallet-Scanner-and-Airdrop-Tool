import dotenv from 'dotenv';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL, SendTransactionError } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createTransferInstruction, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { Metaplex, keypairIdentity } from '@metaplex-foundation/js';
import chalk from 'chalk';
import { table } from 'table';
import inquirer from 'inquirer';
import fs from 'fs';
import { getConnection, loadWalletKey } from './config';

dotenv.config();

interface ChildWallet {
    privateKey: string;
    pubkey: string;
    solBalance: number;
    tokensBalance: Record<string, number>;
}

interface TransactionSummary {
    recipient: string;
    amount: number;
    token: string;
    fee: number;
    signature: string;
    feePayer: string;
    status: 'Success' | 'Failed';
    error?: string;
}

function translateError(error: any): { message: string; isInsufficientFunds: boolean } {
    let message = 'Unknown error occurred';
    let isInsufficientFunds = false;

    if (error instanceof SendTransactionError) {
        if (error.message.includes("Attempt to debit an account but found no record of a prior credit")) {
            message = "Insufficient funds in the child wallet to pay for the transaction fee";
            isInsufficientFunds = true;
        } else if (error.message.includes("Transaction simulation failed")) {
            message = "Transaction simulation failed";
        } else {
            message = "Error sending transaction";
        }
    } else if (error instanceof Error) {
        message = error.message;
    }

    return { message, isInsufficientFunds };
}

async function createNewWallets(count: number): Promise<ChildWallet[]> {
    const newWallets: ChildWallet[] = [];
    for (let i = 0; i < count; i++) {
        const newKeypair = Keypair.generate();
        newWallets.push({
            privateKey: Buffer.from(newKeypair.secretKey).toString('base64'),
            pubkey: newKeypair.publicKey.toBase58(),
            solBalance: 0,
            tokensBalance: {}
        });
    }
    return newWallets;
}

async function main() {
    const answer = await inquirer.prompt([
        {
            type: 'list',
            name: 'network',
            message: 'Select the network:',
            choices: ['mainnet', 'devnet'],
        },
    ]);

    const network = answer.network;
    const connection = await getConnection(network);
    const keypair = await loadWalletKey();
    const metaplex = Metaplex.make(connection).use(keypairIdentity(keypair));

    console.log(chalk.blue("Scanning tokens and SOL balance..."));

    try {
        const solBalance = await connection.getBalance(keypair.publicKey);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(keypair.publicKey, { programId: TOKEN_PROGRAM_ID });

        const tableData = [
            ['Token', 'Symbol', 'Balance', 'Decimals', 'Mint Address']
        ];

        tableData.push(['SOL', 'SOL', (solBalance / LAMPORTS_PER_SOL).toFixed(9), '9', 'Native']);

        const tokens = [];

        for (const { account } of tokenAccounts.value) {
            const parsedAccountInfo: any = account.data.parsed.info;
            const mintAddress = new PublicKey(parsedAccountInfo.mint);
            const tokenBalance = parsedAccountInfo.tokenAmount.uiAmount;
            const decimals = parsedAccountInfo.tokenAmount.decimals;

            try {
                const nft = await metaplex.nfts().findByMint({ mintAddress });
                tableData.push([
                    nft.name || 'Unknown',
                    nft.symbol || 'Unknown',
                    tokenBalance.toString(),
                    decimals.toString(),
                    mintAddress.toBase58()
                ]);
                tokens.push({ name: nft.name || 'Unknown', symbol: nft.symbol || 'Unknown', mintAddress: mintAddress.toBase58(), balance: tokenBalance, decimals });
            } catch (error) {
                tableData.push([
                    'Unknown',
                    'Unknown',
                    tokenBalance.toString(),
                    decimals.toString(),
                    mintAddress.toBase58()
                ]);
                tokens.push({ name: 'Unknown', symbol: 'Unknown', mintAddress: mintAddress.toBase58(), balance: tokenBalance, decimals });
            }
        }

        console.log(chalk.green("\nYour tokens and balances:"));
        console.log(table(tableData));

        const sendTokens = await inquirer.prompt([
            {
                type: 'list',
                name: 'sendType',
                message: 'Do you want to send tokens to child wallets or airdrop to public key addresses?',
                choices: ['Child Wallets', 'Airdrop to Public Keys', 'Cancel']
            }
        ]);

        if (sendTokens.sendType !== 'Cancel') {
            const tokenChoices = tokens.map(token => `${token.name} (${token.symbol}) - Balance: ${token.balance}`);
            tokenChoices.unshift('SOL');

            const sendDetails = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'token',
                    message: 'Select the token to send:',
                    choices: tokenChoices
                },
                {
                    type: 'number',
                    name: 'amount',
                    message: 'Enter the total amount to send:'
                },
                {
                    type: 'number',
                    name: 'wallets',
                    message: 'Enter the number of wallets to send to:'
                },
                {
                    type: 'list',
                    name: 'distribution',
                    message: 'How do you want to distribute the tokens?',
                    choices: ['Even', 'Random']
                },
                {
                    type: 'list',
                    name: 'feePayer',
                    message: 'Who should pay the transaction fees?',
                    choices: ['Main Wallet', 'Recipient Wallets']
                }
            ]);

            let childWallets: ChildWallet[] = [];
            if (sendTokens.sendType === 'Child Wallets') {
                childWallets = JSON.parse(fs.readFileSync('data.json', 'utf-8'));
                if (childWallets.length < sendDetails.wallets) {
                    console.log(chalk.yellow(`Not enough child wallets. Creating ${sendDetails.wallets - childWallets.length} new wallets.`));
                    const newWallets = await createNewWallets(sendDetails.wallets - childWallets.length);
                    childWallets = [...childWallets, ...newWallets];
                    fs.writeFileSync('data.json', JSON.stringify(childWallets, null, 2));
                    console.log(chalk.green(`Updated data.json with new wallets.`));
                }
            } else {
                for (let i = 0; i < sendDetails.wallets; i++) {
                    const answer = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'publicKey',
                            message: `Enter public key for wallet ${i + 1}:`
                        }
                    ]);
                    childWallets.push({ pubkey: answer.publicKey, privateKey: '', solBalance: 0, tokensBalance: {} });
                }
            }

            const selectedToken = tokens.find(token => `${token.name} (${token.symbol}) - Balance: ${token.balance}` === sendDetails.token);

            let amounts: number[];
            if (sendDetails.distribution === 'Even') {
                amounts = Array(sendDetails.wallets).fill(sendDetails.amount / sendDetails.wallets);
            } else {
                const minAmount = sendDetails.amount * 0.7 / sendDetails.wallets;
                const maxAmount = sendDetails.amount * 1.3 / sendDetails.wallets;
                amounts = Array(sendDetails.wallets).fill(0).map(() => Math.random() * (maxAmount - minAmount) + minAmount);
                const totalRandomAmount = amounts.reduce((sum, amount) => sum + amount, 0);
                amounts = amounts.map(amount => amount * sendDetails.amount / totalRandomAmount);
            }

            const transactionSummaries: TransactionSummary[] = [];

            for (let i = 0; i < sendDetails.wallets; i++) {
                const childWallet = childWallets[i];
                const destinationPubkey = new PublicKey(childWallet.pubkey);

                try {
                    if (sendDetails.token === 'SOL') {
                        const transaction = new Transaction().add(
                            SystemProgram.transfer({
                                fromPubkey: keypair.publicKey,
                                toPubkey: destinationPubkey,
                                lamports: Math.floor(amounts[i] * LAMPORTS_PER_SOL)
                            })
                        );

                        const { blockhash } = await connection.getLatestBlockhash();
                        transaction.recentBlockhash = blockhash;

                        let feePayer: Keypair;
                        if (sendDetails.feePayer === 'Recipient Wallets' && sendTokens.sendType === 'Child Wallets') {
                            feePayer = Keypair.fromSecretKey(Buffer.from(childWallet.privateKey, 'base64'));
                            transaction.feePayer = feePayer.publicKey;
                        } else {
                            feePayer = keypair;
                            transaction.feePayer = keypair.publicKey;
                        }

                        transaction.sign(keypair, feePayer);

                        const fee = await connection.getFeeForMessage(transaction.compileMessage());

                        const signature = await connection.sendRawTransaction(transaction.serialize());
                        await connection.confirmTransaction(signature);

                        transactionSummaries.push({
                            recipient: childWallet.pubkey,
                            amount: amounts[i],
                            token: 'SOL',
                            fee: fee.value !== null ? fee.value / LAMPORTS_PER_SOL : 0,
                            signature,
                            feePayer: sendDetails.feePayer === 'Recipient Wallets' ? 'Recipient Wallet' : 'Main Wallet',
                            status: 'Success'
                        });

                        console.log(chalk.green(`Sent ${amounts[i]} SOL to ${childWallet.pubkey}. Transaction signature: ${signature}`));
                    } else if (selectedToken) {
                        const sourceAccount = await getOrCreateAssociatedTokenAccount(
                            connection,
                            keypair,
                            new PublicKey(selectedToken.mintAddress),
                            keypair.publicKey
                        );

                        const destinationAccount = await getOrCreateAssociatedTokenAccount(
                            connection,
                            keypair,
                            new PublicKey(selectedToken.mintAddress),
                            destinationPubkey
                        );

                        const transaction = new Transaction().add(
                            createTransferInstruction(
                                sourceAccount.address,
                                destinationAccount.address,
                                keypair.publicKey,
                                BigInt(Math.floor(amounts[i] * (10 ** selectedToken.decimals)))
                            )
                        );

                        const { blockhash } = await connection.getLatestBlockhash();
                        transaction.recentBlockhash = blockhash;

                        let feePayer: Keypair;
                        if (sendDetails.feePayer === 'Recipient Wallets' && sendTokens.sendType === 'Child Wallets') {
                            feePayer = Keypair.fromSecretKey(Buffer.from(childWallet.privateKey, 'base64'));
                            transaction.feePayer = feePayer.publicKey;
                        } else {
                            feePayer = keypair;
                            transaction.feePayer = keypair.publicKey;
                        }

                        transaction.sign(keypair, feePayer);

                        const fee = await connection.getFeeForMessage(transaction.compileMessage());

                        const signature = await connection.sendRawTransaction(transaction.serialize());
                        await connection.confirmTransaction(signature);

                        transactionSummaries.push({
                            recipient: childWallet.pubkey,
                            amount: amounts[i],
                            token: selectedToken.symbol,
                            fee: fee.value !== null ? fee.value / LAMPORTS_PER_SOL : 0,
                            signature,
                            feePayer: sendDetails.feePayer === 'Recipient Wallets' ? 'Recipient Wallet' : 'Main Wallet',
                            status: 'Success'
                        });

                        console.log(chalk.green(`Sent ${amounts[i]} ${selectedToken.symbol} to ${childWallet.pubkey}. Transaction signature: ${signature}`));
                    }
                } catch (error) {
                    const { message, isInsufficientFunds } = translateError(error);

                    const displayMessage = isInsufficientFunds ? chalk.hex('#FFA500')(message) : chalk.red(message);
                    console.log(displayMessage);

                    transactionSummaries.push({
                        recipient: childWallet.pubkey,
                        amount: amounts[i],
                        token: sendDetails.token === 'SOL' ? 'SOL' : selectedToken!.symbol,
                        fee: 0,
                        signature: 'N/A',
                        feePayer: sendDetails.feePayer === 'Recipient Wallets' ? 'Recipient Wallet' : 'Main Wallet',
                        status: 'Failed',
                        error: message
                    });

                    console.log(chalk.red(`Failed to send to ${childWallet.pubkey}. ${displayMessage}`));
                }
            }

            console.log(chalk.cyan('\n=== Transaction Summary ==='));

            const summaryTable = [
                [
                    chalk.bold('Recipient'),
                    chalk.bold('Amount'),
                    chalk.bold('Token'),
                    chalk.bold('Fee (SOL)'),
                    chalk.bold('Fee Payer'),
                    chalk.bold('Status'),
                    chalk.bold('Signature/Error')
                ]
            ];

            let totalFees = 0;
            let successfulTransactions = 0;
            let failedTransactions = 0;

            transactionSummaries.forEach(summary => {
                const status = summary.status === 'Success'
                    ? chalk.green(summary.status)
                    : chalk.red(summary.status);

                let signatureOrError;
                if (summary.status === 'Success') {
                    signatureOrError = chalk.green(summary.signature);
                } else {
                    const { isInsufficientFunds } = translateError({ message: summary.error });
                    signatureOrError = isInsufficientFunds ? chalk.hex('#FFA500')(summary.error) : chalk.red(summary.error);
                }

                summaryTable.push([
                    summary.recipient,
                    summary.amount.toString(),
                    summary.token,
                    summary.fee.toFixed(9),
                    summary.feePayer,
                    status,
                    signatureOrError
                ]);

                if (summary.status === 'Success') {
                    totalFees += summary.fee;
                    successfulTransactions++;
                } else {
                    failedTransactions++;
                }
            });

            const tableConfig = {
                columns: {
                    6: { width: 70, wrapWord: true }
                }
            };

            console.log(table(summaryTable, tableConfig));

            console.log(chalk.yellow(`Total fees paid: ${totalFees.toFixed(9)} SOL`));
            console.log(chalk.green(`Successful transactions: ${successfulTransactions}`));
            console.log(chalk.red(`Failed transactions: ${failedTransactions}`));

            if (sendDetails.feePayer === 'Main Wallet') {
                console.log(chalk.magenta("Note: All fees were paid by the main wallet."));
            } else {
                console.log(chalk.magenta("Note: Fees were paid by each recipient wallet for their respective transactions (where possible)."));
            }

            console.log(chalk.cyan('\n=== Transaction Details ==='));

            transactionSummaries.forEach((summary, index) => {
                console.log(chalk.cyan(`\nTransaction ${index + 1}:`));
                console.log(chalk.white(`Recipient: ${summary.recipient}`));
                console.log(chalk.white(`Amount: ${summary.amount} ${summary.token}`));
                console.log(chalk.white(`Fee: ${summary.fee.toFixed(9)} SOL`));
                console.log(chalk.white(`Fee Payer: ${summary.feePayer}`));
                console.log(chalk.white(`Status: ${summary.status === 'Success' ? chalk.green(summary.status) : chalk.red(summary.status)}`));

                if (summary.status === 'Success') {
                    console.log(chalk.green(`Signature: ${summary.signature}`));
                } else {
                    const { isInsufficientFunds } = translateError({ message: summary.error });
                    const errorColor = isInsufficientFunds ? chalk.hex('#FFA500') : chalk.red;
                    console.log(errorColor('Error:'));
                    console.log(errorColor(summary.error || 'Unknown error'));
                }
            });
        }

    } catch (error) {
        console.error(chalk.red('Error scanning tokens:'), error instanceof Error ? error.message : String(error));
    }
}

main().catch(console.error);