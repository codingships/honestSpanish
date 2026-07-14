import { closeSync, fsyncSync, openSync, rmSync, writeSync } from 'node:fs';

export function removeSentryProductionExecutionLock(lockPath: string): void {
    rmSync(lockPath);
}

export function writeSentryProductionFinalizationPending(filePath: string, contents: string): void {
    writeDurableFile(filePath, contents, 'wx');
}

export function writeSentryProductionHardeningReceipt(filePath: string, contents: string): void {
    writeDurableFile(filePath, contents, 'w');
}

export function removeSentryProductionFinalizationPending(filePath: string): void {
    rmSync(filePath);
}

function writeDurableFile(filePath: string, contents: string, flags: 'w' | 'wx'): void {
    const descriptor = openSync(filePath, flags);
    try {
        writeSync(descriptor, contents, null, 'utf8');
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}
