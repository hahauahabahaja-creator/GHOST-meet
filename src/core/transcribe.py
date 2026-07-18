import sys
import os
import whisper
import warnings
import torch

warnings.filterwarnings("ignore")

def run_transcription(audio_file, output_file):
    if not os.path.exists(audio_file):
        return

    print("💎 GHOST meet | AI ENGINE: Loading OpenAI Whisper...")

    device = "cuda" if torch.cuda.is_available() else "cpu"

    try:
        model = whisper.load_model("small", device=device)

        print(f"💎 GHOST meet | AI ENGINE: Transcribing using {device.upper()}...")

        result = model.transcribe(
            audio_file,
            verbose=False,
            fp16=False if device == "cpu" else True
        )

        with open(output_file, 'w', encoding='utf-8') as f:
            f.write("━━━━━━━━━━━━━━━━━━━━━━\n")
            f.write("💎 GHOST meet | AI TRANSCRIPTION (OPENAI WHISPER)\n")
            f.write("━━━━━━━━━━━━━━━━━━━━━━\n")
            f.write(f"Engine: OpenAI Whisper AI (Small Model)\n")
            f.write(f"Detected Language: {result.get('language', 'unknown')}\n")
            f.write("Mode: Native Hinglish (Hindi + English Mix)\n\n")

            f.write("📋 AI MEETING SUMMARY & ACTION ITEMS\n")
            f.write("━━━━━━━━━━━━━━━━━━━━━━\n")

            # More robust keyword extraction for Summary
            summary_points = []
            action_items = []

            keywords_summary = ["decide", "conclude", "summary", "final", "agree", "discuss", "problem", "solution"]
            keywords_actions = ["tomorrow", "task", "assign", "do it", "fix", "issue", "send", "update", "check"]

            for segment in result['segments']:
                text = segment['text'].lower()
                if any(k in text for k in keywords_summary):
                    summary_points.append(segment['text'].strip())
                if any(k in text for k in keywords_actions):
                    action_items.append(segment['text'].strip())

            f.write("🔹 KEY DECISIONS / DISCUSSIONS:\n")
            if summary_points:
                for p in summary_points[:5]:
                    f.write(f" • {p}\n")
            else:
                f.write(" • No specific conclusions detected.\n")

            f.write("\n🔸 ACTION ITEMS / TASKS:\n")
            if action_items:
                for a in action_items[:5]:
                    f.write(f" • {a}\n")
            else:
                f.write(" • No specific tasks identified.\n")

            f.write("━━━━━━━━━━━━━━━━━━━━━━\n\n")

            f.write("📑 FULL TRANSCRIPT:\n")
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
