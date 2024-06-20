import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import tmp from 'tmp';

tmp.setGracefulCleanup();

function findPdflatexSync(): string | null {
    try {
        const command = process.platform === 'win32' ? 'where pdflatex' : 'which pdflatex';
        const stdout = execSync(command).toString();
        return stdout.split('\n')[0].trim();
    } catch (err) {
        vscode.window.showErrorMessage('pdflatex not found in PATH. Please ensure that LaTeX is installed and pdflatex is accessible from your PATH.');
        return null;
    }
}

function createTempDir(): string {
    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    return tempDir.name;
}

async function describeObject(selectedText: string, selectedObject: string) {
    const apiKey = vscode.workspace.getConfiguration().get<string>('chatGPT.apiKey');
    if (!apiKey || apiKey.trim() === "") {
        vscode.window.showInformationMessage('Please configure your OpenAI API key in the Settings.');
        return;
    }

    const headers = {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
    };

    const prompt = `### Instruction ###
Given text and object, your task is to identify and enumerate all the properties of the object from the provided text and your knowledge.
If there's no information about the object in the text, and you cannot infer significant properties, respond with: "No info about this object in text".
If you know some true properties, you can instead enumerate them.

### Current data context ###
# Text #
${selectedText}
# Object #
${selectedObject}

### Output format ###
\\item First property of the object in LaTeX
\\item Second property of the object in LaTeX

### Examples ###
# Text #
In quantum computing, the density matrix ( \rho ) represents the state of a quantum system, accommodating both pure states and mixed states. The purity of a quantum state, defined by the trace of the square of the density matrix, (\\operatorname(Tr)(\rho^2)), is a critical metric. Pure states have a purity of 1, indicating a state with a well-defined quantum state. In contrast, mixed states have purity less than 1, reflecting a statistical mixture of states.
# Object #
\\operatorname(Tr)(\rho^2)
# Answer #
\\item Represents the purity of a quantum state described by the density matrix \\( \rho \\).
\\item Calculated as the trace of the square of \\( \rho \\), given by:
\\[
\\operatorname(Tr)(\rho^2).
\\]
\\item A value of \\( 1 \\) indicates a pure state, while values less than \\( 1 \\) denote mixed states, correlating with the degree of mixture or uncertainty in the quantum system state.

### Your Answer ###`;
    
    const data = {
        "model": "gpt-4-turbo-2024-04-09",
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.4
    };

    const statusBarItem = vscode.window.setStatusBarMessage("Waiting for response from GPT...");

    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', data, { headers: headers });
        statusBarItem.dispose();
        return response.data.response.choices[0].message.content;
    } catch (error) {
        statusBarItem.dispose();
        vscode.window.showErrorMessage('Error sending text to GPT: ' + error);
        return '';
    }
}

async function compileLatex(latexContent: string) {
    const pdflatexPath = findPdflatexSync();
    if (!pdflatexPath) {
        return;
    }

    const tempDir = createTempDir();
    const tempTexPath = path.join(tempDir, 'temp.tex');
    fs.writeFileSync(tempTexPath, latexContent);

    try {
        execSync(`"${pdflatexPath}" -output-directory="${tempDir}" "${tempTexPath}"`);
    } catch (error) {
        vscode.window.showErrorMessage('There was an error compiling the LaTeX document: ' + error);
        return;
    }

    const tempPdfPath = path.join(tempDir, 'temp.pdf');
    const uri = vscode.Uri.file(tempPdfPath);
    try {
        await vscode.commands.executeCommand('vscode.open', uri);
    } catch (error) {
        vscode.window.showErrorMessage('Failed to open the compiled PDF file. Make sure you have PDF VSСode extension');
    }
}

export function activate(context: vscode.ExtensionContext) {
    let selectedText: string;
    context.subscriptions.push(vscode.commands.registerCommand('mathobjectidentifier.processText', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("No open text editor.");
            return;
        }

        const selection = editor.selection;
        selectedText = editor.document.getText(selection);

        if (!selectedText) {
            vscode.window.showInformationMessage("No text selected.");
            return;
        }

        vscode.window.showInformationMessage("Now select object and press Ctrl+Enter.");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('mathobjectidentifier.describeObject', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("No open text editor.");
            return;
        }

        const selection = editor.selection;
        const selectedObject = editor.document.getText(selection);

        if (!selectedObject) {
            vscode.window.showInformationMessage("No text selected.");
            return;
        }

        const modelContent = await describeObject(selectedText, selectedObject);
        let latexContent;
        if (modelContent.includes("No info about this object in text")) {
            latexContent = `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\begin{document}

${modelContent}

\\end{document}`;
        } else {
            latexContent = `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\begin{document}

\\begin{itemize}
${modelContent}
\\end{itemize}
\\end{document}`;
}

        await compileLatex(latexContent);
    }));
}

export function deactivate() {}