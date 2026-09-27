import { Buffer } from 'buffer';
globalThis.Buffer = Buffer; // isomorphic-git needs a global Buffer in browsers
