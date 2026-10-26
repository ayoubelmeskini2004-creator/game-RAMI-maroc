import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { browser } from './browser-support.mjs';
import { pickupReturnBrowser } from './browser-pickup-return.mjs';
const artifacts=new URL('../.audit-artifacts/discard-decision/',import.meta.url);await mkdir(artifacts,{recursive:true});const chrome=await browser();
try{await pickupReturnBrowser(chrome,artifacts);assert.deepEqual(chrome.errors,[]);}finally{await chrome.close();}
