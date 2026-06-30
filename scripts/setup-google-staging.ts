/**
 * Create or reuse the Google Drive resources needed by the staging environment.
 *
 * It uses the current Google credentials from .env and creates:
 * - a staging root folder under GOOGLE_DRIVE_ROOT_FOLDER_ID
 * - a staging template document by copying GOOGLE_TEMPLATE_DOC_ID
 *
 * Run:
 *   pnpm exec tsx scripts/setup-google-staging.ts
 */
import 'dotenv/config';
import { drive } from '@googleapis/drive';
import { JWT } from 'google-auth-library';

const stagingRootName = process.env.GOOGLE_STAGING_ROOT_FOLDER_NAME || 'STAGING - Espanol Honesto';
const stagingTemplateName = process.env.GOOGLE_STAGING_TEMPLATE_DOC_NAME || 'STAGING - Plantilla de clase';

const requiredEnv = [
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_TEMPLATE_DOC_ID',
] as const;

for (const key of requiredEnv) {
    if (!process.env[key]) {
        throw new Error(`Missing ${key}`);
    }
}

const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: process.env.GOOGLE_ADMIN_EMAIL,
});

const driveClient = drive({ version: 'v3', auth });

function escapeDriveQueryValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFile(input: {
    name: string;
    parentId: string;
    mimeType?: string;
}) {
    const conditions = [
        `name = '${escapeDriveQueryValue(input.name)}'`,
        `'${input.parentId}' in parents`,
        'trashed = false',
    ];

    if (input.mimeType) {
        conditions.push(`mimeType = '${input.mimeType}'`);
    }

    const response = await driveClient.files.list({
        q: conditions.join(' and '),
        fields: 'files(id,name,mimeType,webViewLink)',
        spaces: 'drive',
    });

    return response.data.files?.[0] ?? null;
}

async function ensureStagingRoot() {
    const parentId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;
    const existing = await findFile({
        name: stagingRootName,
        parentId,
        mimeType: 'application/vnd.google-apps.folder',
    });

    if (existing?.id) {
        return { id: existing.id, link: existing.webViewLink, created: false };
    }

    const response = await driveClient.files.create({
        requestBody: {
            name: stagingRootName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
        },
        fields: 'id,name,webViewLink',
    });

    if (!response.data.id) {
        throw new Error('Google Drive did not return a staging root folder ID');
    }

    return { id: response.data.id, link: response.data.webViewLink, created: true };
}

async function ensureStagingTemplate(parentId: string) {
    const existing = await findFile({
        name: stagingTemplateName,
        parentId,
        mimeType: 'application/vnd.google-apps.document',
    });

    if (existing?.id) {
        return { id: existing.id, link: existing.webViewLink, created: false };
    }

    const response = await driveClient.files.copy({
        fileId: process.env.GOOGLE_TEMPLATE_DOC_ID!,
        requestBody: {
            name: stagingTemplateName,
            parents: [parentId],
        },
        fields: 'id,name,webViewLink',
    });

    if (!response.data.id) {
        throw new Error('Google Drive did not return a staging template document ID');
    }

    return { id: response.data.id, link: response.data.webViewLink, created: true };
}

async function main() {
    await auth.authorize();

    const root = await ensureStagingRoot();
    const template = await ensureStagingTemplate(root.id);

    console.log('Google staging resources ready.');
    console.log(`GOOGLE_DRIVE_ROOT_FOLDER_ID=${root.id}`);
    console.log(`GOOGLE_TEMPLATE_DOC_ID=${template.id}`);
    console.log(`root_created=${root.created}`);
    console.log(`template_created=${template.created}`);

    if (root.link) console.log(`root_link=${root.link}`);
    if (template.link) console.log(`template_link=${template.link}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
