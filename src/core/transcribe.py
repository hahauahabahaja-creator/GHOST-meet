import sys
import os
import whisper
import warnings
import torch

# Suppress warnings
warnings.filterwarnings("ignore")

def run_transcription(audio_file, output_file):
    if not os.path.exists(audio_file):
        return

    print("💎 GHOST meet | AI ENGINE: Loading OpenAI Whisper...")

    # Check for GPU, otherwise use CPU
    device = "cuda" if torch.cuda.is_available() else "cpu"

    try:
        # Using 'base' model: Fast, accurate, and fits GitHub RAM perfectly
        model = whisper.load_model("base", device=device)

        print(f"💎 GHOST meet | AI ENGINE: Transcribing using {device.upper()}...")

        # Transcribe with Hinglish context (Hindi + English)
        # Using task='transcribe' to keep it in original language (Hinglish)
        result = model.transcribe(
            audio_file,
            verbose=False,
            language='hi',
            task='transcribe',
            fp16=False if device == "cpu" else True
        )

        with open(output_file, 'w', encoding='utf-8') as f:
            f.write("━━━━━━━━━━━━━━━━━━━━━━\n")
            f.write("💎 GHOST meet | AI TRANSCRIPTION (OPENAI WHISPER)\n")
            f.write("━━━━━━━━━━━━━━━━━━━━━━\n")
            f.write("Engine: OpenAI Whisper AI (Base Model)\n")
            f.write("Mode: Native Hinglish (Hindi + English Mix)\n\n")

            # Extract segments for better timestamping
            for segment in result['segments']:
                start = segment['start']
                mins = int(start // 60)
                secs = int(start % 60)
                timestamp = f"[{mins}:{secs:02d}]"
                f.write(f"{timestamp} {segment['text'].strip()}\n")

            f.write("\n━━━━━━━━━━━━━━━━━━━━━━\n")
            f.write("✅ SYSTEM: STT PIPELINE COMPLETE\n")
            f.write("━━━━━━━━━━━━━━━━━━━━━━\n")

        print(f"SUCCESS: AI Transcription saved to {output_file}")

    except Exception as e:
        print(f"CRITICAL ERROR: {str(e)}")
        with open(output_file, 'a', encoding='utf-8') as f:
            f.write(f"\n🚨 STT ERROR: {str(e)}\n")

if __name__ == "__main__":
    if len(sys.argv) >= 3:
        run_transcription(sys.argv[1], sys.argv[2])
