const { By, Builder, Browser, Key, WebDriver, until } = require("selenium-webdriver");
const fs = require("fs");
const path = require("path");

const baseUrl = "http://localhost:8081/";
const downloadsDir = "/Users/gary/Downloads";
const testDir = "./docs/examples";
const outDir = "./docs/generatedImages";

const delay = ms => new Promise(r => setTimeout(r, ms));

/**
 * @param {WebDriver} driver
 * @param {string} json
 */
async function downloadOne(driver, json, outfileName) {
    await driver.executeAsyncScript(`
    window._hasGfontConsent = "true"; // string return value of window.confirm()
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const callback = arguments[arguments.length - 1];
    let attempts = 10;
    while (!window._debugGlobalMonacoEditor && attempts --> 0) {
        await delay(1000);
    }
    window._debugGlobalMonacoEditor.getModel().setValue('${JSON.stringify(json)}');
    callback();
    `);

    const statusField = await driver.findElement(By.id("status-field"));

    async function waitForRender() {
        do {
            await driver.wait(until.elementTextIs(statusField, "Rendered"));
            await delay(1500);
        } while ((await statusField.getText()) !== "Rendered");
    }

    await waitForRender();
    const downloadButton = await driver.findElement(By.id("download-button"));
    await downloadButton.click();
    await delay(1000);

    const files = fs.readdirSync(downloadsDir);
    const match = files
        .filter(fname => fname.startsWith(json.title))
        .map(fname => [fname, fs.statSync(path.join(downloadsDir, fname)).ctimeMs])
        .sort((fa, fb) => fb[1] - fa[1])
        .map(([fname, _ctime]) => fname)[0];
    fs.copyFileSync(path.join(downloadsDir, match), path.join(outDir, outfileName));
    fs.rmSync(path.join(downloadsDir, match));
}

async function main() {
    const driver = await new Builder().forBrowser(Browser.CHROME).build();
    await driver.get(baseUrl);

    console.log(await driver.getTitle());

    for (const fname of fs.readdirSync(testDir)) {
        if (!fname.endsWith(".json")) {
            continue;
        }

        console.log(`Rendering ${fname}`);
        const json = fs.readFileSync(path.join(testDir, fname));
        try {
            await downloadOne(driver, JSON.parse(json), `${fname.split(".json")[0]}.rendered.png`);
        } catch (e) {
            console.error("failed to render", e);
            await delay(10000);
        }
    }

    await driver.close();
}

main();
