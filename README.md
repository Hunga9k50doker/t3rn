# ᝰ.ᐟ T3rn

Tool được phát triển bởi nhóm tele Airdrop Hunter Siêu Tốc (https://t.me/airdrophuntersieutoc)

## 🚨 Attention Before Running T3rn Cli Version

I am not `responsible` for the possibility of an account being `banned`!

## 📎 T3rn Node cli version Script features

- Auto swap, bridge (op sepolia, arb sepolia, base sepolia, unichain sepolia)
- Check points
- Support proxy or not
- Mutiple threads, multiple accounts

## ✎ᝰ. RUNNING

Make sure you have at least 4 ETH in 1 of the 4 networks below. If not, contact me to purchase. https://t.me/huyautomation2x

- Clone Repository

```bash
git clone https://github.com/Hunga9k50doker/t3rn.git
cd t3rn
```

- Install Dependency

```bash
npm install
```

- Setup config in .env

```bash
nano .env
```

- Setup wallets, you must run again this command when you have any change in privateKeys.txt

```bash
node setup
```

- Setup input value

* proxy: http://user:pass@ip:port

```bash
nano proxies.txt
```

- privateKeys: how to get privateKeys => join my channel: https://t.me/airdrophuntersieutoc

```bash
nano privateKeys.txt
```

- Run the script

```bash
node main.js
```
