import sys
import os
import speech_recognition as sr
import wave
import contextlib

# Try to import transliteration library for Hinglish mode
try:
    from indic_transliteration import sanscript
    from indic_transliteration.sanscript import transliterate
    HAS_TRANSLIT = True
except ImportError:
    HAS_TRANSLIT = False

CHUNK_DURATION = 60  # Increase to 60 seconds for better context

def get_audio_duration(audio_file):
    with contextlib.closing(wave.open(audio_file, 'r')) as f:
        frames = f.getnframes()
        rate = f.getframerate()
        duration = frames / float(rate)
        return duration

def convert_to_hinglish(text):
    """Convert Devanagari text to Hinglish (Romanized)"""
    if not HAS_TRANSLIT or not text.strip():
        return text
    try:
        # Improved transliteration call with fallback
        result = transliterate(text, sanscript.DEVANAGARI, sanscript.ITRANS).lower()
        return result if result.strip() else text
    except Exception as e:
        print(f"Transliteration Error: {e}")
        return text

def run_transcription(audio_file, output_file):
    recognizer = sr.Recognizer()
    recognizer.energy_threshold = 200 # Lower threshold for better sensitivity
    recognizer.dynamic_energy_threshold = True
    recognizer.pause_threshold = 0.8

    if not os.path.exists(audio_file):
        print(f"ERROR: Audio file {audio_file} not found.")
        return

    try:
        duration = get_audio_duration(audio_file)
        file_size = os.path.getsize(audio_file) / 1024 # KB
        print(f"GHOST meet STT: Processing {duration:.2f}s of audio ({file_size:.2f} KB)...")
    except Exception as e:
        print(f"Warning: Could not determine duration/size: {e}")
        duration = None
        file_size = 0

    # Initialize output file
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write("━━━━━━━━━━━━━━━━━━━━━━\n")
        f.write("💎 GHOST meet | AI TRANSCRIPTION (HINDI + HINGLISH)\n")
        f.write("━━━━━━━━━━━━━━━━━━━━━━\n")
        f.write(f"Audio Duration: {duration:.2f}s\n")
        f.write(f"Audio Quality: Normalised (loudnorm)\n\n")

    try:
        with sr.AudioFile(audio_file) as source:
            chunks_processed = 0
            offset = 0
            all_text_found = False
            
            while True:
                try:
                    # If we have duration, stop when offset exceeds it
                    if duration and offset >= duration:
                        break

                    print(f"GHOST meet STT: Processing chunk at offset {offset}s...")
                    audio_chunk = recognizer.record(source, duration=CHUNK_DURATION)

                    if not audio_chunk or not audio_chunk.frame_data:
                        break
                        
                    # Transcribe this chunk (Google Web Speech API)
                    try:
                        chunk_text = recognizer.recognize_google(audio_chunk, language='hi-IN')
                        if chunk_text:
                            all_text_found = True
                            hinglish_chunk = convert_to_hinglish(chunk_text)

                            with open(output_file, 'a', encoding='utf-8') as f:
                                f.write(f"[{int(offset/60)}:{int(offset%60):02d}] {hinglish_chunk}\n")
                    except sr.UnknownValueError:
                        print(f"GHOST meet STT: Chunk at {offset}s - no speech detected.")
                    except sr.RequestError as e:
                        print(f"GHOST meet STT: API error at {offset}s: {e}")
                    
                    offset += CHUNK_DURATION
                    chunks_processed += 1
                except EOFError:
                    break

        # Finalize output file
        with open(output_file, 'a', encoding='utf-8') as f:
            f.write("\n??????????????????????\n")
            if all_text_found:
                f.write(f"SYSTEM: STT COMPLETE ({chunks_processed} chunks)\n")
            else:
                f.write("SYSTEM: STT COMPLETE (No speech detected)\n")
            f.write("Language: Bilingual (Hindi + Hinglish Romanized)\n")

        print(f"SUCCESS: Transcript saved to {output_file}")

    except Exception as e:
        print(f"STT CRITICAL ERROR: {str(e)}")
        with open(output_file, 'a', encoding='utf-8') as f:
            f.write(f"\n? STT ERROR: {str(e)}\n")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(1)

    run_transcription(sys.argv[1], sys.argv[2])

if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(1)

    run_transcription(sys.argv[1], sys.argv[2])
