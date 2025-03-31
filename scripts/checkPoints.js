process.on("SIGINT", () => {
  console.log("Exiting...");
  process.exit();
});
const { HttpsProxyAgent } = require("https-proxy-agent");
const { ethers } = require("ethers");
const colors = require("colors");
const fs = require("fs");
const path = require("path");
const _ = require("lodash");
const settings = require("../config/config.js");
const axios = require("axios");
const { loadData } = require("../utils.js");
const walletsPath = path.join(__dirname, "wallets.json");
let wallets = [];

try {
  wallets = JSON.parse(fs.readFileSync(walletsPath, "utf8"));
} catch (error) {
  console.error(colors.red("Error reading wallets.json:", error.message));
  process.exit(1);
}

// Tạo provider

const getCoinBalance = async (address, proxy, proxyIP) => {
  try {
    // Gửi yêu cầu GET đến API
    let proxyAgent = null;
    if (proxy) {
      proxyAgent = new HttpsProxyAgent(proxy);
    }
    const response = await axios.get(`${settings.BASE_URL}/addresses/${address}`, {
      headers: {
        referer: `https://b2n.explorer.caldera.xyz/address/${address}`,
      },
      ...(proxyAgent
        ? {
            httpsAgent: proxyAgent,
            httpAgent: proxyAgent,
          }
        : {}),
    });

    // Lấy số dư coin từ phản hồi
    const coinBalance = response.data.coin_balance;
    // Chuyển đổi số dư từ chuỗi thành BigInt (nếu cần)
    const balanceInEth = BigInt(coinBalance) / BigInt(10 ** 18); // Giả sử có 18 chữ số thập phân
    console.log(`[${proxyIP}][${address}] | Balance: ${balanceInEth.toString()} BRN`.green);
  } catch (error) {
    if (error.status === 404) {
      console.warn(`[${proxyIP}][${address}] | Wallet not have any translations on BRN chain, create new translation and then check again`.yellow);
    } else {
      console.error(`[${proxyIP}][${address}] | Failed check balance:`.red, error.message);
    }
  }
};

async function checkProxyIP(proxy) {
  if (!proxy) return null;
  try {
    const proxyAgent = new HttpsProxyAgent(proxy);
    const response = await axios.get("https://api.ipify.org?format=json", { httpsAgent: proxyAgent });
    if (response.status === 200) {
      return response.data.ip;
    } else {
      console.error(`Cannot check proxy IP. Status code: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.error(`Error checking proxy IP: ${error.message}`);

    return null;
  }
}

const checkBalance = async () => {
  const proxies = loadData("proxies.txt");

  for (let i = 0; i < wallets.length; i++) {
    let proxy = proxies[i];
    const wallet = wallets[i];
    let proxyIP = null;
    if (proxy) {
      proxyIP = await checkProxyIP(proxy);
    }
    if (proxyIP) {
      console.log(colors.blue(`[${proxyIP}] Checking BRN: ${wallet.address}`));
    } else {
      proxy = null;
      proxyIP = "Local IP";
      console.log(colors.blue(`[Local IP] Checking BRN: ${wallet.address}`));
    }
    try {
      await getCoinBalance(wallet.address, proxy, proxyIP);
    } catch (error) {
      console.error(`Lỗi khi kiểm tra số dư cho ví ${wallet.address}:`, error.message);
    }
  }
};

module.exports = {
  checkBalance,
};
