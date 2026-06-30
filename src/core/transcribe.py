import sys
import os
import speech_recognition as sr

def run_transcription(audio_file, output_file):
    """
    Complete API-free Speech-to-Text extraction.
    Supports English + Hindi using the Google Web Speech wrapper.
    """
    recognizer = sr.Recognizer()

    if not os.path.exists(audio_file):
        print(f"ERROR: Audio file {audio_file} not found.")
        return

    print(f"GHOST meet STT: Processing {audio_file}...")

    try:
        with sr.AudioFile(audio_file) as source:
            # Calibrate for ambient noise
            recognizer.adjust_for_ambient_noise(source, duration=0.5)
            # Record entire file
            audio_payload = recognizer.record(source)

        print("GHOST meet STT: Extracting mixed Hindi/English data...")

        # 'hi-IN' is the target language but Google's engine is highly robust
        # and automatically handles mixed code-switching (English words in Hindi sentences).
        text_content = recognizer.recognize_google(audio_payload, language='hi-IN')

        # Format and save to workspace
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write("━━━━━━━━━━━━━━━━━━━━━━\n")
            f.write("🛸 GHOST meet | AI TRANSCRIPTION\n")
            f.write("━━━━━━━━━━━━━━━━━━━━━━\n\n")
            f.write(text_content)
            f.write("\n\n━━━━━━━━━━━━━━━━━━━━━━\n")
            f.write("SYSTEM: STT COMPLETE (HINDI + ENGLISH)\n")

        print(f"SUCCESS: Transcript saved to {output_file}")

    except sr.UnknownValueError:
        print("STT FAILURE: Speech was too faint or unrecognizable.")
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write("GHOST meet: No recognizable speech detected in this session.")
    except sr.RequestError as e:
        print(f"STT FAILURE: Network/Service error: {e}")
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(f"GHOST meet: Transcription service unavailable. Error: {e}")
    except Exception as e:
        print(f"STT CRITICAL ERROR: {str(e)}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("USAGE: python3 transcribe.py <input.wav> <output.txt>")
        sys.exit(1)

    run_transcription(sys.argv[1], sys.argv[2])
