process.on("SIGINT", () => {
  console.log("Exiting...");
  process.exit();
});

const consoleClear = require("console-clear");
const figlet = require("figlet");
const { ethers } = require("ethers");
const colors = require("colors");
const fs = require("fs");
const path = require("path");
const inquirer = require("inquirer");
const _ = require("lodash");
const { estimateFees } = require("./apis");
const chains = require("./chains");
const { orderABI } = require("../ABI");
const { getRandomNumber } = require("../utils");
const settings = require("../config/config.js");
const walletsPath = path.join(__dirname, "wallets.json");
let wallets = [];
try {
  wallets = JSON.parse(fs.readFileSync(walletsPath, "utf8"));
} catch (error) {
  console.error(colors.red("Error reading wallets.json:", error.message));
  process.exit(1);
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;
const MIN_BRIDGE_TXS = settings.TIMES_SWAP[0];
const MAX_BRIDGE_TXS = settings.TIMES_SWAP[1];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const selectDestinationChain = (sourceChainKey, enabledChains) => {
  const availableChains = Object.keys(enabledChains).filter((chain) => chain !== sourceChainKey);
  if (availableChains.length === 0) throw new Error(`No available destination chains for source chain ${sourceChainKey}`);
  return availableChains[Math.floor(Math.random() * availableChains.length)];
};

const performTransaction = async (wallet, sourceChainKey, destinationChainKey, amountETH, enabledChains, retryCount = 0) => {
  const sourceChain = enabledChains[sourceChainKey];
  const destinationChain = enabledChains[destinationChainKey];
  const amountWei = ethers.utils.parseEther(amountETH.toString()).toString();
  const destinationHEX = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(destinationChain.ASCII_REF)).slice(0, 10);

  let estimatedData;
  try {
    estimatedData = await estimateFees(amountWei, sourceChainKey, destinationChainKey);
  } catch (error) {
    console.log(colors.red("Error fetching estimations from the API:", error.message));
    return;
  }

  if (!estimatedData) {
    console.log(colors.red("Error fetching estimations from the API."));
    return;
  }

  const params = {
    destination: destinationHEX,
    asset: 0,
    targetAccount: ethers.utils.hexZeroPad(wallet.address, 32),
    amount: ethers.BigNumber.from(estimatedData.estimatedReceivedAmountWei.hex).toString(),
    rewardAsset: "0x0000000000000000000000000000000000000000",
    insurance: 0,
    maxReward: ethers.utils.parseEther(amountETH.toString()).toString(),
  };

  if (!sourceChain.ROUTER) {
    console.log(colors.red(`The ROUTER address for chain ${sourceChainKey} is not configured.`));
    return;
  }

  const provider = new ethers.providers.JsonRpcProvider(sourceChain.RPC_URL);
  const walletObj = new ethers.Wallet(wallet.privateKey, provider);
  const routerContract = new ethers.Contract(sourceChain.ROUTER, orderABI, walletObj);

  try {
    const feeData = await provider.getFeeData();
    const baseFee = feeData.lastBaseFeePerGas || feeData.maxFeePerGas || ethers.utils.parseUnits("1", "gwei");
    const maxFeePerGas = baseFee.mul(125).div(100);
    let gasLimit;

    try {
      gasLimit = (
        await routerContract.estimateGas.order(
          ethers.utils.hexZeroPad(params.destination, 4),
          params.asset,
          params.targetAccount,
          params.amount,
          params.rewardAsset,
          params.insurance,
          params.maxReward,
          { value: ethers.utils.parseEther(amountETH.toString()) }
        )
      )
        .mul(110)
        .div(100);
    } catch {
      gasLimit = Math.floor(Math.random() * (sourceChain.maxGasLimit - sourceChain.minGasLimit + 1)) + sourceChain.minGasLimit;
    }

    const tx = await routerContract.order(ethers.utils.hexZeroPad(params.destination, 4), params.asset, params.targetAccount, params.amount, params.rewardAsset, params.insurance, params.maxReward, {
      value: ethers.utils.parseEther(amountETH.toString()),
      maxFeePerGas,
      maxPriorityFeePerGas: maxFeePerGas,
      gasLimit,
    });

    console.log(colors.green(`Performing Bridge from [${sourceChain.ASCII_REF}] to [${destinationChain.ASCII_REF}]`));
    console.log(colors.green(`Tx Amount: [${amountETH}] ETH`));
    console.log(colors.green(`Tx Hash Sent! - ${sourceChain.TX_EXPLORER}/${tx.hash}`));

    const receipt = await tx.wait();
    console.log(colors.green(`Tx Confirmed in Block [${receipt.blockNumber}]`));
    console.log();
  } catch (error) {
    if (error.message.toLowerCase().includes("insufficient funds") && retryCount < MAX_RETRIES) {
      const newAmountETH = parseFloat((amountETH * 0.95).toFixed(5));
      console.log(colors.red("INSUFFICIENT_FUNDS: Retrying with 5% less amount."));
      await sleep(RETRY_DELAY_MS);
      await performTransaction(wallet, sourceChainKey, destinationChainKey, newAmountETH, enabledChains, retryCount + 1);
    } else {
      console.log(colors.red("Error creating bridge order:", error.message));
    }
  }
};

const fetchBalances = async (wallet, enabledChains) => {
  const balances = {};
  await Promise.all(
    Object.keys(enabledChains).map(async (chainKey) => {
      try {
        const provider = new ethers.providers.JsonRpcProvider(enabledChains[chainKey].RPC_URL);
        const balanceWei = await provider.getBalance(wallet.address);
        balances[chainKey] = parseFloat(ethers.utils.formatEther(balanceWei));
      } catch {
        balances[chainKey] = 0;
      }
    })
  );
  return balances;
};

const processWallet = async (wallet, useRandomTxs, enabledChains) => {
  console.log(colors.green(`Starting bridge workflow for Wallet [${wallet.address}]`));
  const balances = await fetchBalances(wallet, enabledChains);
  const availableSourceChains = Object.keys(balances).filter((chainKey) => balances[chainKey] >= settings.AMOUNT[1]);

  if (availableSourceChains.length === 0) {
    console.log(colors.blue(`No transactions can be performed for wallet: ${wallet.address}`));
    return;
  }

  const totalTxs = availableSourceChains.reduce((sum, chainKey) => sum + Math.floor(balances[chainKey] / settings.AMOUNT[1]), 0);
  const transactionsToPerform = useRandomTxs ? getRandomInt(MIN_BRIDGE_TXS, MAX_BRIDGE_TXS) : totalTxs;

  console.log(colors.green(`Total transactions able to perform: [${transactionsToPerform}]`));
  for (let txIndex = 0; txIndex < transactionsToPerform; txIndex++) {
    const sourceChainKey = availableSourceChains[Math.floor(Math.random() * availableSourceChains.length)];
    const destinationChainKey = selectDestinationChain(sourceChainKey, enabledChains);
    const amountETH = getRandomNumber(settings.AMOUNT[0], settings.AMOUNT[1]);
    console.log(colors.green(`Transaction ${txIndex + 1} for wallet [${wallet.address}] from [${sourceChainKey}]`));
    await performTransaction(wallet, sourceChainKey, destinationChainKey, amountETH, enabledChains);
    await sleep(useRandomTxs ? 60000 : 10000);
  }

  console.log(colors.blue(`Completed transactions for wallet: ${wallet.address}`));
};

const isRestingTime = () => {
  const hourUTC = new Date().getUTCHours();
  return hourUTC >= 1 && hourUTC < 10;
};

const autoBridge = async () => {
  consoleClear();
  const configAnswers = await inquirer.prompt([
    { type: "confirm", name: "useRandomTxs", message: "Random transactions per wallet?", default: false },
    { type: "confirm", name: "useBatches", message: "Use multiple threads?", default: false },
    { type: "confirm", name: "useRestingTime", message: "Use Resting Time (1:00 AM - 10:00 AM UTC)?", default: false },
  ]);

  const { useRandomTxs, useBatches, useRestingTime } = configAnswers;

  const disabledChainsAnswer = await inquirer.prompt([
    {
      type: "checkbox",
      name: "disabledChains",
      message: "Select the chains you want to disable:",
      choices: Object.keys(chains),
    },
  ]);

  const enabledChains = _.omit(chains, disabledChainsAnswer.disabledChains);

  if (_.isEmpty(enabledChains)) {
    console.error(colors.red("Error: All chains have been disabled. Exiting."));
    process.exit(1);
  }

  const shuffledWallets = _.shuffle(wallets);
  console.log(colors.green(`Enabled chains: ${Object.keys(enabledChains).join(", ")}`));
  console.log(colors.green(`Disabled chains: ${disabledChainsAnswer.disabledChains.join(", ")}`));

  while (true) {
    if (useRestingTime && isRestingTime()) {
      console.log(colors.green("Resting time active. Sleeping for 30 minutes..."));
      await sleep(30 * 60 * 1000);
      continue;
    }

    if (useBatches) {
      for (let i = 0; i < shuffledWallets.length; i += 10) {
        const batch = shuffledWallets.slice(i, i + 10);
        console.log(colors.green(`Processing batch of wallets ${i + 1} to ${i + batch.length}`));
        await Promise.allSettled(batch.map((wallet) => processWallet(wallet, useRandomTxs, enabledChains)));
      }
    } else {
      for (const wallet of shuffledWallets) {
        await processWallet(wallet, useRandomTxs, enabledChains);
      }
    }

    console.log(colors.green(`Finished a round of transactions. Waiting ${settings.TIME_SLEEP} minutes before the next round.`));
    await sleep(settings.TIME_SLEEP * 60000);
  }
};

const getRandomInt = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};
module.exports = {
  autoBridge,
};
