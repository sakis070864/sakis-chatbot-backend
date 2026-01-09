const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURATION ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY_INTAKE;
const DEVELOPER_INFO_PASSWORD = process.env.DEVELOPER_INFO;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);


// --- Firebase Admin SDK Initialization ---
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountString) {
        throw new Error('Firebase service account key environment variable is not set.');
    }
    const serviceAccount = JSON.parse(serviceAccountString);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin SDK initialized successfully.');

} catch (error) {
    console.error('CRITICAL ERROR: Firebase Admin SDK initialization failed. Intake reports will not be saved.', error.message);
}

const db = admin.firestore();

// --- Nodemailer Configuration ---
const mailerConfig = {
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
};

if (!mailerConfig.auth.user || !mailerConfig.auth.pass) {
    console.error('CRITICAL ERROR: Nodemailer is not configured. EMAIL_USER or EMAIL_PASS environment variables are missing. Email notifications will fail.');
}
const transporter = nodemailer.createTransport(mailerConfig);


// --- KNOWLEDGE BASE LOADING ---
let qaData = [];
try {
    const filePath = path.join(__dirname, '400QA2.json');
    if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        qaData = JSON.parse(fileContent);
        console.log(`Successfully loaded ${qaData.length} Q&A items into the knowledge base.`);
    } else {
        console.warn('WARNING: 400QA2.json not found. The general chatbot will have no custom knowledge.');
    }
} catch (error) {
    console.error('CRITICAL ERROR: Could not load or parse 400QA2.json.', error);
}

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- ROUTES ---
app.get('/', (req, res) => {
    res.send('Sakis Athan AI Chatbot Server with RAG and Intake is running!');
});

/**
 * Endpoint for the general-purpose Q&A chatbot.
 */
app.post('/chat', async (req, res) => {
    console.log('--- NEW /chat REQUEST ---');
    
    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
    }

    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Request body must contain a "message" field.' });
    }
    console.log(`[Chat-1] Received user message: "${message}"`);

    const getRelevantSnippets = (query, data, count = 7) => {
        const queryWords = query.toLowerCase().split(/\s+/);
        const scoredItems = data
            .filter(item => item.Q && item.A)
            .map(item => {
                const questionWords = item.Q.toLowerCase();
                let score = 0;
                queryWords.forEach(word => {
                    if (questionWords.includes(word)) {
                        score++;
                    }
                });
                return { ...item, score };
            })
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score);

        return scoredItems.slice(0, count);
    };

    const relevantSnippets = getRelevantSnippets(message, qaData);
    const knowledgeBase = relevantSnippets.length > 0
        ? relevantSnippets.map(item => `Q: ${item.Q}\nA: ${item.A}`).join('\n\n')
        : 'No specific information found in the knowledge base for this query.';
    
    console.log(`[Chat-2] Found ${relevantSnippets.length} relevant snippets.`);

    const systemInstructionContent = `You are 'Sakis Bot', a friendly and professional AI assistant for Sakis Athan, an AI & Automation Engineer. 
        Your primary goal is to answer the user's question based on the provided "Relevant Information" below. You MUST prioritize this information. If the information provides a good answer, use it directly. If the information is not sufficient, you may use your general knowledge but you must relate it back to Sakis's skills and services.
        Keep your answers concise and helpful. Always be professional and encourage potential clients to get in touch for detailed project discussions. Sakis's contact info is sakissystems@gmail.com.
        --- RELEVANT INFORMATION START ---
        ${knowledgeBase}
        --- RELEVANT INFORMATION END ---
        `;

    const safetySettings = [
        {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
        },
    ];

        try {
        console.log('[Chat-3] Sending request to Gemini API...');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds timeout

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", safetySettings });
        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{ text: systemInstructionContent }],
                },
                {
                    role: "model",
                    parts: [{ text: "Okay, I understand. I will adhere to these instructions." }],
                },
            ],
            generationConfig: {
                maxOutputTokens: 200,
            },
        });

        const result = await chat.sendMessage(message, { signal: controller.signal });
        clearTimeout(timeoutId);
        const response = await result.response;
        const replyContent = response.text();
        
        console.log('[Chat-5] Successfully processed reply. Sending response back to the client.');
        res.json({ reply: replyContent });

    } catch (error) {
        console.error('[FATAL ERROR] An error occurred in the /chat try-catch block:', error.message);
        res.status(500).json({ error: 'Failed to fetch response from AI.' });
    }
});

/**
 * Endpoint for the intelligent project intake conversation.
 */
app.post('/intake', async (req, res) => {
    console.log('--- NEW /intake REQUEST ---');

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
    }

    const { conversation } = req.body;

    if (!conversation || !Array.isArray(conversation) || conversation.length === 0) {
        return res.status(400).json({ error: 'Request body must contain a "conversation" array.' });
    }

    try {
        // **MODIFICATION**: Enhanced the AI Project Analyst's prompt for more thorough questioning.
        const analystSystemPromptContent = `You are an expert AI Project Analyst for Sakis Athan. Your goal is to conduct a thorough and intelligent interview with a potential client to fully understand their project needs. Your questioning must be comprehensive.

        **Your Process:**
        1.  **Analyze the entire conversation history** to understand what has been discussed.
        2.  **Identify Missing Information:** Your primary task is to identify critical missing details. Specifically probe for:
            - **Target Audience:** Who will be using this tool or system? (e.g., "Who are the primary users of this system?")
            - **Key Integrations:** What other software, APIs, or data sources does this need to connect with? (e.g., "Does this tool need to integrate with any other platforms like a CRM, Google Sheets, or a specific API?")
            - **Success Metrics:** How will the client know the project is successful? What is the desired outcome? (e.g., "What would a successful outcome look like for you?", "How will you measure the success of this automation?")
            - **Workflow Details:** Deeply understand the current manual process you are replacing. Ask for step-by-step descriptions.
        3.  **Ask ONE Insightful Question:** Based on your analysis, ask the single best, open-ended follow-up question to uncover this missing information. Do not ask multiple questions at once.
        4.  **Determine Completion:** Only after you have a clear understanding of the project's goals, users, integrations, and success metrics (which usually requires at least 3-4 follow-up questions from you), you MUST end your response with the exact phrase: "[END_OF_INTAKE]". Do not end the interview prematurely.
        
        **Rules:**
        - Be professional, curious, and analytical.
        - Never end the intake on your first or second response. Always probe deeper.
        - If you are not ending the intake, ONLY output the next question. No preamble.`;

        const analystSafetySettings = [
            {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
        ];

        const analystHistory = [
            {
                role: "user",
                parts: [{ text: analystSystemPromptContent }],
            },
            ...conversation.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }],
            }))
        ];

        const lastUserMessage = conversation[conversation.length - 1].content;

        console.log(`[Intake-1] Asking Analyst AI about: "${lastUserMessage}"`);
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds timeout

            const analystModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash", safetySettings: analystSafetySettings });
            const analystChat = analystModel.startChat({ history: analystHistory });
            const analystResult = await analystChat.sendMessage(lastUserMessage, { signal: controller.signal });
            clearTimeout(timeoutId);
            const analystResponse = await analystResult.response;
            analystReply = analystResponse.text();
        } catch (geminiError) {
            console.error('[ERROR] Error communicating with Gemini API for analyst:', geminiError);
            return res.status(500).json({ error: 'Failed to get response from Analyst AI.' });
        }

        if (analystReply.includes('[END_OF_INTAKE]')) {
            console.log('[Intake-2] Analyst determined intake is complete. Proceeding to report generation.');
            
            const currentDate = new Date().toUTCString();
            const managerSystemPromptContent = `You are a Senior Project Manager. You will be given a transcript of a client interview. Your task is to create a structured, professional project report in JSON format.
            The JSON object must have these exact keys: "projectName", "projectSummary", "keyFeatures", "estimatedTimeline", "interviewDate".
            - projectName: A concise, descriptive name for the project.
            - projectSummary: A 2-3 sentence paragraph summarizing the client's problem and the proposed solution.
            - keyFeatures: An array of strings, with each string being a specific feature or requirement.
            - estimatedTimeline: A string providing a rough, non-binding estimate of the work required (e.g., "5-8 hours", "3-5 business days", "2-3 weeks").
            - interviewDate: The date and time of the interview. Use this exact value: "${currentDate}".
            Analyze the transcript carefully to provide a realistic estimate. Base your response ONLY on the provided transcript.`;

            const managerSafetySettings = [
                {
                    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
            ];

            const managerHistory = [
                {
                    role: "user",
                    parts: [{ text: managerSystemPromptContent }],
                },
                {
                    role: "user",
                    parts: [{ text: `Here is the interview transcript:\n\n${conversation.map(m => `${m.role}: ${m.content}`).join('\n')}` }],
                }
            ];
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds timeout

                const managerModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash", safetySettings: managerSafetySettings });
                const managerChat = managerModel.startChat({
                    history: managerHistory,
                    generationConfig: { responseMimeType: "application/json" },
                });
                const managerResult = await managerChat.sendMessage("Generate the project report as a JSON object.", { signal: controller.signal });
                clearTimeout(timeoutId);
                const managerResponse = await managerResult.response;
                reportJsonString = managerResponse.text();
            } catch (geminiError) {
                console.error('[ERROR] Error communicating with Gemini API for manager:', geminiError);
                return res.status(500).json({ error: 'Failed to generate project report.' });
            }
            let report;

            try {
                report = JSON.parse(reportJsonString);
                if (!report.projectName || !report.projectSummary || !report.keyFeatures || !report.estimatedTimeline || !report.interviewDate) {
                    throw new Error("AI response was valid JSON but missing required fields.");
                }
            } catch (e) {
                console.error("Failed to parse or validate the report JSON from AI.", {
                    error: e.message,
                    aiResponse: reportJsonString
                });
                throw new Error("The AI failed to generate a valid project report. Please try again.");
            }

            const now = new Date();
            const caseNumber = `SA-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

            console.log(`[Intake-4] Saving report to Firestore with Case Number: ${caseNumber}`);
            await db.collection('intakeReports').doc(caseNumber).set({
                ...report,
                caseNumber: caseNumber,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                fullTranscript: conversation
            });

            console.log('[Intake-5] Sending email notification...');
            const emailBody = `
                <h1>New Project Intake Report</h1>
                <p><strong>Case Number:</strong> ${caseNumber}</p>
                <p><strong>Interview Date:</strong> ${report.interviewDate}</p>
                <hr>
                <h2>${report.projectName}</h2>
                <p><strong>Summary:</strong> ${report.projectSummary}</p>
                <h3>Key Features:</h3>
                <ul>
                    ${report.keyFeatures.map(f => `<li>${f}</li>`).join('')}
                </ul>
                <p><strong>Estimated Timeline:</strong> ${report.estimatedTimeline}</p>
                <hr>
                <h3>Full Transcript:</h3>
                ${conversation.map(m => `<p><strong>${m.role === 'user' ? 'Client' : 'Analyst'}:</strong> ${m.content}</p>`).join('')}
            `;

            await transporter.sendMail({
                from: `"Sakis AI Intake Bot" <${mailerConfig.auth.user}>`,
                to: "sakissystems@gmail.com",
                subject: `New Project Intake: ${report.projectName} (${caseNumber})`,
                html: emailBody,
            });

            console.log('[Intake-6] Process complete. Sending confirmation to client.');
            res.json({ status: 'complete', caseNumber: caseNumber, report: report });

        } else {
            console.log('[Intake-2] Analyst provided a new question. Continuing conversation.');
            res.json({ status: 'in-progress', reply: analystReply });
        }

    } catch (error) {
        console.error('[FATAL ERROR] An error occurred in the /intake try-catch block:', error.message);
        res.status(500).json({ error: 'An internal error occurred while processing your request.' });
    }
});

/**
 * Endpoint for verifying the developer password.
 */
app.post('/verify-developer', (req, res) => {
    console.log('--- NEW /verify-developer REQUEST ---');
    const { password } = req.body;

    if (!DEVELOPER_INFO_PASSWORD) {
        console.error('[ERROR] DEVELOPER_INFO environment variable is not set on the server.');
        return res.status(500).json({ success: false, message: 'Server configuration error.' });
    }

    if (!password) {
        return res.status(400).json({ success: false, message: 'Password is required.' });
    }

    if (password === DEVELOPER_INFO_PASSWORD) {
        console.log('[Auth] Developer password verified successfully.');
        res.json({ success: true });
    } else {
        console.log('[Auth] Incorrect developer password attempt.');
        res.status(401).json({ success: false, message: 'Incorrect password.' });
    }
});


// --- SERVER START ---
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
