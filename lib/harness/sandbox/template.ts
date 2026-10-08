import { Template } from "e2b";

export const decisionFeedSandbox = Template()
  .fromImage("python:3.11")
  .aptInstall(["libreoffice", "fonts-liberation", "nodejs", "npm", "chromium"])
  .pipInstall(["python-docx", "python-pptx", "openpyxl", "reportlab", "pandas", "matplotlib", "Pillow", "beautifulsoup4", "httpx"])
  .npmInstall(["puppeteer", "sharp"], { g: true });
