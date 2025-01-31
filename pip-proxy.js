const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');
const printLogo = require('./src/logo');

class Pip {
    constructor() {
        this.baseHeaders = {
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
            "Content-Type": "application/json",
            "Origin": "https://tg.pip.world",
            "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        };
        this.config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
        this.proxies = fs.readFileSync('proxy.txt', 'utf8').replace(/\r/g, '').split('\n').filter(Boolean);
    }

    getHeaders(initData) {
        return {
            ...this.baseHeaders,
            "Authorization": initData
        };
    }

    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        switch(type) {
            case 'success':
                console.log(`[${timestamp}] ✅ ${msg}`.green);
                break;
            case 'custom':
                console.log(`[${timestamp}] 🔮 ${msg}`.magenta);
                break;        
            case 'error':
                console.log(`[${timestamp}] ❌ ${msg}`.red);
                break;
            case 'warning':
                console.log(`[${timestamp}] ⚠️ ${msg}`.yellow);
                break;
            default:
                console.log(`[${timestamp}] * ${msg}`.blue);
        }
    }

    async countdown(seconds) {
        for (let i = seconds; i >= 0; i--) {
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`⏳ Wait ${i} seconds before the next loop`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('');
    }

    async checkProxyIP(proxy) {
        try {
            const proxyAgent = new HttpsProxyAgent(proxy);
            const response = await axios.get('https://api.ipify.org?format=json', { httpsAgent: proxyAgent });
            if (response.status === 200) {
                return response.data.ip;
            } else {
                throw new Error(`Cannot check proxy IP. Status code: ${response.status}`);
            }
        } catch (error) {
            throw new Error(`Error checking proxy IP: ${error.message}`);
        }
    }

    getAxiosInstance(proxy) {
        const proxyAgent = new HttpsProxyAgent(proxy);
        return axios.create({
            httpsAgent: proxyAgent,
            proxy: false
        });
    }

    async refillEnergy(headers) {
        const refillUrl = "https://api.tg.pip.world/app/post/activateFreeRefillEnergy";
        try {
            const refillResponse = await this.axiosInstance.post(refillUrl, {}, { headers });
            if (refillResponse.status === 200) {
                const user = refillResponse.data.user;
                this.log('Energy refilled successfully', 'success');
                this.log(`Energy: ${user.energy}/${user.maxUserEnergy}`, 'custom');
                this.log(`Remaining refills: ${user.freeEnergyRefills.available}`, 'custom');
                return user;
            }
        } catch (error) {
            this.log(`Error refilling energy: ${error.message}`, 'error');
        }
        return null;
    }

    async buyInvestItem(headers, itemId, itemPrice, userBalance) {
        const buyUrl = "https://api.tg.pip.world/app/post/buyInvestItem38539";
        try {
            const buyResponse = await this.axiosInstance.post(buyUrl, { itemId }, { headers });
            
            if (buyResponse.status === 200) {
                const user = buyResponse.data.user;
                this.log(`Successfully upgraded card: ${itemId} | New balance: ${user.balance}`, 'success');
                return user;
            }
        } catch (error) {
            this.log(`Error buying item ${itemId}: ${error.message}`, 'error');
            return false;
        }
        return false;
    }
    
    async upgradeCards(headers, user, initData) {
        try {
            const availableItemsResponse = await this.axiosInstance.get("https://api.tg.pip.world/app/get/getUserInvestItems", { headers });
            const availableItems = availableItemsResponse.data.investItems || [];
    
            const ownedItemsResponse = await this.axiosInstance.get("https://api.tg.pip.world/app/get/getUserOwnedInvestItems", { headers });
            const ownedItems = ownedItemsResponse.data.userOwnedInvestItems || [];
    
            const ownedItemMap = new Map();
            for (const item of ownedItems) {
                const baseId = item.id.replace(/_\d+$/, '');
                ownedItemMap.set(baseId, item);
            }
    
            const currentTimestamp = Math.floor(Date.now() / 1000);
    
            for (const item of availableItems) {
                if (item.validUntil && currentTimestamp > item.validUntil) {
                    this.log(`Card ${item.id} has expired (${new Date(item.validUntil * 1000).toLocaleString()}), skipping`, 'warning');
                    continue;
                }
    
                const baseId = item.id.replace(/_\d+$/, '');
                const ownedItem = ownedItemMap.get(baseId);
    
                if (item.upgradeValuePerHour && ownedItem) {
                    this.log(`Checking upgrade for card ${item.title}`, 'info');
                    this.log(`Price: ${item.price} | Profit/hour: ${item.profitPerHour} | Increase: ${item.upgradeValuePerHour}`, 'info');
    
                    if (user.balance >= item.price && item.price <= this.config.maxInvestPrice) {
                        const buyResult = await this.buyInvestItem(headers, item.id, item.price, user.balance);
                        if (buyResult === false) {
                            this.log(`Unable to upgrade card: ${item.id}`, 'warning');
                            continue;
                        }
                        user = buyResult;
                        
                        ownedItemMap.set(baseId, {
                            ...ownedItem,
                            level: ownedItem.level + 1,
                            profitPerHour: item.profitPerHour
                        });
                    } else {
                        this.log(`Not enough balance to upgrade card ${item.title} (${item.price} > ${user.balance})`, 'warning');
                    }
                }
                else if (!ownedItem && !item.upgradeValuePerHour) {
                    this.log(`Checking new card purchase: ${item.title}`, 'info');
                    this.log(`Price: ${item.price} | Profit/hour: ${item.profitPerHour}`, 'info');
    
                    if (user.balance >= item.price && item.price <= this.config.maxInvestPrice) {
                        const buyResult = await this.buyInvestItem(headers, item.id, item.price, user.balance);
                        if (buyResult === false) {
                            this.log(`Unable to buy card: ${item.id}`, 'warning');
                            continue;
                        }
                        user = buyResult;
                        
                        ownedItemMap.set(baseId, {
                            id: item.id,
                            title: item.title,
                            profitPerHour: item.profitPerHour,
                            level: 1
                        });
                    } else {
                        this.log(`Not enough balance to buy card ${item.title} (${item.price} > ${user.balance})`, 'warning');
                    }
                }
            }
    
            return user;
        } catch (error) {
            this.log(`Error while upgrading cards: ${error.message}`, 'error');
            return user;
        }
    }

    async getQuestIds(loginResponse) {
        const quests = loginResponse.data.quests?.quests || [];
        const currentTimestamp = Math.floor(Date.now() / 1000);
        
        return quests
            .filter(quest => 
                !quest.completed && 
                (quest.validUntil === null || currentTimestamp <= quest.validUntil)
            )
            .map(quest => quest.id);
    }

    async checkAndCompleteQuests(headers, questIds) {
        const checkQuestUrl = "https://api.tg.pip.world/app/post/checkQuest49944";
        
        for (const questId of questIds) {
            try {
                const checkResponse = await this.axiosInstance.post(checkQuestUrl, { questId }, { headers });
                
                if (checkResponse.status === 200) {
                    const quests = checkResponse.data.quests?.quests;
                    if (quests) {
                        const quest = quests.find(q => q.id === questId);
                        if (quest) {
                            this.log(`Quest ${quest.title} completed | Reward ${quest.reward}`, 'success');
                        } else {
                            this.log(`Could not find quest with ID ${questId}`, 'info');
                        }
                    } else {
                        this.log(`No quests found in response`, 'info');
                    }
                } else {
                    this.log(`Unexpected response when checking quest ${questId}: ${checkResponse.status}`, 'warning');
                }
            } catch (error) {
                if (error.response) {
                    if (error.response.status === 400) {
                        this.log(`Quest ${questId} invalid or expired`, 'warning');
                    } else {
                        this.log(`Error checking quest ${questId}: ${error.response.status} - ${error.response.data}`, 'error');
                    }
                } else {
                    this.log(`Error checking quest ${questId}: ${error.message}`, 'error');
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }    

    async loginAndUpdateUser(initData) {
        const loginUrl = "https://api.tg.pip.world/app/post/login29458";
        const boardingCompletedUrl = "https://api.tg.pip.world/app/post/boardingCompleted";
        //const passiveIncomeUrl = "https://api.tg.pip.world/app/get/yieldpassiveincome";
        const updateTradingGroupUrl = "https://api.tg.pip.world/app/patch/updateUserTradingGroup";
        const headers = this.getHeaders(initData);
    
        try {
            const loginPayload = {
                initData: initData,
                referredBy: "6269851518"
            };
    
            const loginResponse = await this.axiosInstance.post(loginUrl, loginPayload, { headers });
            
            if (loginResponse.status === 200) {
                this.log('Login successful!', 'success');
                let user = loginResponse.data.user;
                this.log(`Balance: ${user.balance}`, 'info');
    
                if (!user.boardingCompleted) {
                    const groupId = Math.floor(Math.random() * 4) + 1;
                    const updateGroupResponse = await this.axiosInstance.patch(updateTradingGroupUrl, 
                        { groupId: groupId.toString() },
                        { headers }
                    );
                    
                    if (updateGroupResponse.status === 200) {
                        const groupName = updateGroupResponse.data.user.tradingGroupData.name;
                        this.log(`You have joined group ${groupName}`, 'success');
                        const boardingCompletedResponse = await this.axiosInstance.post(boardingCompletedUrl, {}, { headers });
                        
                        if (boardingCompletedResponse.status === 200) {
                            this.log('Boarding process completed', 'success');
                            user = boardingCompletedResponse.data.user;
                        }
                    }
                }
    
                const questIds = await this.getQuestIds(loginResponse);
                await this.checkAndCompleteQuests(headers, questIds);
    
                //const passiveIncomeResponse = await this.axiosInstance.get(passiveIncomeUrl, { headers });
    
                //if (passiveIncomeResponse.status === 200) {
                //    user = passiveIncomeResponse.data.user;
    
                user = await this.performTaps(headers, user);
                user = await this.upgradeCards(headers, user, initData);

                return user;
                //}
            }
        } catch (error) {
            this.log(`Error in loginAndUpdateUser: ${error.message}`, 'error');
            console.error(error);
        }
    }

    async activateFreeTapsMultiplier(headers) {
        const activateUrl = "https://api.tg.pip.world/app/post/activateFreeTapsMultiplier";
        try {
            const activateResponse = await this.axiosInstance.post(activateUrl, {}, { headers });
            if (activateResponse.status === 200) {
                const user = activateResponse.data.user;
                return user;
            }
        } catch (error) {
            this.log(`Error activating tap boost: ${error.message}`, 'error');
        }
        return null;
    }

    async performTaps(headers, user) {
        const tapHandlerUrl = "https://api.tg.pip.world/app/post/tapHandler22224";
        let isFirstTap = true;

        while (true) {
            let tapAmount = isFirstTap ? user.coinsPerTap : user.energy;

            if (tapAmount === 0) {
                this.log('No energy left to tap', 'warning');
                break;
            }
            if (!isFirstTap && user.freeTapsMultiplier.available > 0) {
                const currentTime = Math.floor(Date.now() / 1000);
                if (currentTime > user.freeTapsMultiplier.lastTimeUpdated + 3600) {
                    const updatedUser = await this.activateFreeTapsMultiplier(headers);
                    if (updatedUser) {
                        user = updatedUser;
                        tapAmount = user.energy * 5;
                        this.log(`Tap boost activated. Boosted taps: ${tapAmount}`, 'custom');
                    }
                }
            }

            const tapPayload = { coins: tapAmount };
            try {
                const tapResponse = await this.axiosInstance.post(tapHandlerUrl, tapPayload, { headers });
                
                if (tapResponse.status === 200) {
                    user = tapResponse.data.user;
                    this.log(`Tap successful: ${tapAmount} coins`, 'success');
                    this.log(`Energy: ${user.energy}/${user.maxUserEnergy}`, 'custom');
                    this.log(`Balance: ${user.balance}`, 'custom');
                    this.log(`Full Energy: ${user.freeEnergyRefills.available}`, 'custom');
                    this.log(`Tap boosts: ${user.freeTapsMultiplier.available}`, 'custom');
                    isFirstTap = false;
                    
                    if (user.energy < 20 && user.freeEnergyRefills.available > 0) {
                        const refillResult = await this.refillEnergy(headers);
                        if (!refillResult) {
                            this.log('Unable to refill energy', 'warning');
                            break;
                        }
                        user = refillResult;
                    } else if (user.energy < 20) {
                        this.log('No energy left and no free refills available', 'warning');
                        break;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else {
                    this.log('Tap failed', 'error');
                    break;
                }
            } catch (error) {
                this.log(`Error during tap: ${error.message}`, 'error');
                this.log(`Error during tap: ${error.message}`, 'error');
                if (error.response) {
                    this.log(`Server responded with status: ${error.response.status}`, 'error');
                    this.log(`Response data: ${JSON.stringify(error.response.data)}`, 'error');
                }
                break;
            }
        }

        return user;
    }

    async main() {
        const dataFile = path.join(__dirname, 'data.txt');
        const data = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);

        while (true) {
            printLogo();
            for (let i = 0; i < data.length; i++) {
                const initData = data[i];
                const userData = JSON.parse(decodeURIComponent(initData.split('user=')[1].split('&')[0]));
                const firstName = userData.first_name;
                const proxy = this.proxies[i];

                let proxyIP = 'Unknown';
                try {
                    proxyIP = await this.checkProxyIP(proxy);
                } catch (error) {
                    this.log(`Cannot check proxy IP: ${error.message}`, 'warning');
                    continue;
                }

                console.log(`👤 Account ${(i + 1).toString().cyan} | 🧑 ${firstName.green} | 🌐 ${proxyIP.yellow} | 🚀 Starting...`);
                
                this.axiosInstance = this.getAxiosInstance(proxy);

                try {
                    const result = await this.loginAndUpdateUser(initData);
                    console.log(`✅ Account ${(i + 1).toString().cyan} | 🧑 ${firstName.green} | 🌐 ${proxyIP.yellow} | 🏁 Finished`);
                } catch (error) {
                    this.log(`Error processing account ${i + 1}: ${error.message}`, 'error');
                }

                console.log('─'.repeat(50).gray);  // Separator line
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            await this.countdown(5 * 60);
        }
    }
}
const client = new Pip();
client.main().catch(err => {
    client.log(err.message, 'error');
    process.exit(1);
});