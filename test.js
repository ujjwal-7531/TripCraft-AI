import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

try {
  const models = await genAI.listModels();
  console.log(models);
} catch (e) {
  console.error(e);
}