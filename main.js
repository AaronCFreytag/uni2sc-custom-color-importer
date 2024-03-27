const chars = require('./chars.json');
const { program } = require('commander');
const fs = require('fs').promises;
const path = require('path');

const ENABLE_VERBOSE_LOGGING = true;
const PALETTES_PER_CHAR = 5;
const PALETTE_SIZE = 8;
const MAX_PALETTE_SELECTION_VALUE = 39;
const BACKUP_TIME_DIFFERENCE = 7 * 24 * 60 * 60 * 1000;

function validateChars() {
  if (chars.length === 0) {
    throw new Error(`No characters found`);
  }

  chars.forEach((char) => {
    if (char.exists === true && char.name == '') {
      throw new Error(`Character with ID ${char.id} has no name!`);
    }
  })

  const {indices, offsets} = chars.reduce(({indices, offsets}, curr) => {
    indices.push(curr.id);
    offsets.push(parseOffset(curr.offset));
    return {indices, offsets};
  }, {indices: [], offsets: []});
  
  validateContiguousArray('indices', indices, 1);
  validateContiguousArray('offsets', offsets, 0x40);
}

function validateContiguousArray(name, arr, distance) {

  logVerbose(`Validating array - name: ${name}, arr: ${arr}, distance: ${distance}`);
  const sortedArr = arr.slice().sort((a, b) => a - b);
  logVerbose(`Sorted arr: ${sortedArr}`);
  const nextValues = sortedArr.slice(1);
  nextValues.forEach((value, index) => {
    const prevValue = sortedArr[index];
    if (value - prevValue !== distance) {
      throw new Error(`Values for ${name} were not contiguous between ${prevValue} and ${value}`);
    }
  });
}

function parseOffset(offsetString) {
  return parseInt(offsetString, 16);
}

function bufferToPalette(buf) {
  if (buf.length != 8) {
    throw new Error(`Buffer ${buf} does not have correct length (expected: 8)`);
  }
  return [
    buf[1],
    buf[2],
    buf[3],
    buf[4],
    buf[5],
    buf[6]
  ]
}

function paletteToBuffer(palette) {
  if (palette.length != 6) {
    throw new Error(`Palette ${palette} does not have correct length (expected: 6)`);
  }
  return Buffer.from([0x00].concat(palette).concat([0x00]));
}

function logVerbose(...data) {
  if (ENABLE_VERBOSE_LOGGING) {
    console.log(...data);
  }
}

function log(...data) {
  console.log(...data);
}

function getCharacterData(name) {
  const char = chars.find((char) => char.name == name);
  if (char == null) {
    throw new Error(`Could not find character with name ${name}`);
  }
  return char;
}

function validateSysData(data) {
  const header = Buffer.from('UNIEL-SaveData ');

  if (data.length < header.length) {
    throw new Error(`Save file too small (expected at least ${header.length}, actual: ${data.length})`);
  }

  if (!data.subarray(0, header.length).equals(header)) {
    throw new Error('Save file header did not match expected header');
  }

  chars.forEach((char) => {
    for (let i = 0; i < PALETTES_PER_CHAR; i++) {
      const offset = getPaletteOffset(char, i);
      if (offset > data.length) {
        throw new Error(`Save file too small (expected at least ${offset}, actual: ${data.length})`);
      }
      const paletteBuffer = data.subarray(offset, offset + PALETTE_SIZE);
      const palette = bufferToPalette(paletteBuffer);

      palette.forEach((v) => {
        if (v > MAX_PALETTE_SELECTION_VALUE) {
          throw new Error('Unexpected value found in save data');
        }
      })
    }
  });
}

async function getLatestBackupTime(savePath) {
  const root = path.dirname(savePath);
  const files = await fs.readdir(root);
  
  logVerbose(files);

  let latestBackupTime = 0;
  for (const file of files) {
    if (file.startsWith('SYS-DATA.backup-')) {
      const stat = await fs.stat(path.join(root, file));
      latestBackupTime = Math.max(latestBackupTime, stat.birthtimeMs);
    }
  }

  return latestBackupTime;
}

function getPaletteOffset(characterData, paletteNum) {
  const offset = parseOffset(characterData.offset);
  return offset + paletteNum * PALETTE_SIZE;
}

async function backupSysData(savePath) {
  const latestBackupTime = await getLatestBackupTime(savePath);
  const timestamp = Date.now();

  if (timestamp - latestBackupTime > BACKUP_TIME_DIFFERENCE) {
    const sysData = await fs.readFile(savePath);
    await fs.writeFile(path.join(`${savePath}.backup-${timestamp}`), sysData);
  }
}

try {
  logVerbose('Validating characters...');
  validateChars()
  logVerbose('Character validation complete.');
}
catch(err) {
  console.error('Error validating chars.json: ', err);
  return;
}

program
  .name('uni2sc-custom-color-importer')
  .description('CLI to export and import UNI2 character skins')
  .version('0.0.1');

program
  .command('export')
  .description('Export a skin from UNI2')
  .argument('<path>', 'Path to your UNDER NIGHT IN-BIRTH II Sys Celes SYS-DATA file (e.g. \"C:/Steam/steamapps/common/UNDER NIGHT IN-BIRTH II Sys Celes/Save/{<a number>}/SYS-DATA\")')
  .argument('<character>', 'The character to export the skin for')
  .argument('<slot>', 'The slot to export the skin from')
  .argument('<path>', 'The location to export the skin to')
  .action(async (savePath, character, slot, skin) => {
    if (slot < 1 || slot > 5) {
      program.error("Slot must be between 1 and 5");
    }

    log(`Exporting custom palette ${slot} for ${character} to ${skin}...`);

    try {
      const sysData = await fs.readFile(savePath);
      validateSysData(sysData);

      const characterData = getCharacterData(character.toLowerCase());
      const characterPaletteIndex = slot - 1;
      const offset = getPaletteOffset(characterData, characterPaletteIndex);
      const paletteBuffer = sysData.subarray(offset, offset + PALETTE_SIZE);
      const palette = bufferToPalette(paletteBuffer);

      try {
        await fs.mkdir(path.dirname(skin));
      }
      catch (err) {
        if (err.code != 'EEXIST') {
          throw err;
        }
      }
      console.log(palette);
      await fs.writeFile(skin, Buffer.from(palette));
    }
    catch(err) {
      console.error('Error executing import command: ', err);
    }
  });

program
  .command('import')
  .description('Import a skin into UNI2')
  .argument('<path>', 'Path to your UNDER NIGHT IN-BIRTH II Sys Celes SYS-DATA file (e.g. \"C:/Steam/steamapps/common/UNDER NIGHT IN-BIRTH II Sys Celes/Save/{<a number>}/SYS-DATA\")')
  .argument('<character>', 'The character to import the skin for')
  .argument('<slot>', 'The slot to import the skin to. (1-5)')
  .argument('<skin>', 'The path of the skin to import')
  .action(async (savePath, character, slot, skin) => {
    if (slot < 1 || slot > 5) {
      program.error("Slot must be between 1 and 5");
    }

    log(`Importing palette from ${skin} to custom palette ${slot} for ${character}...`);

    let sysDataHandle;

    try {
      backupSysData(savePath);

      const palette = [...(await fs.readFile(skin))];

      sysDataHandle = await fs.open(savePath, 'r+');
      validateSysData(await sysDataHandle.readFile());

      const characterData = getCharacterData(character.toLowerCase());
      const characterPaletteIndex = slot - 1;
      const offset = getPaletteOffset(characterData, characterPaletteIndex);
      const paletteBuffer = paletteToBuffer(palette);

      await sysDataHandle.write(paletteBuffer, 0, paletteBuffer.length, offset);
    }
    catch(err) {
      console.error('Error executing import command: ', err);
    }
    finally {
      if (sysDataHandle) {
        sysDataHandle.close();
      }
    }

  });

program.parse();