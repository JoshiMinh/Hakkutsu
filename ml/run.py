import os
import subprocess
import sys

def get_python_exec():
    # Prefer the local .venv python if it exists
    venv_python = os.path.join(os.path.dirname(__file__), ".venv", "Scripts", "python.exe")
    return venv_python if os.path.exists(venv_python) else sys.executable

def install_requirements():
    print("\n--- Setting up Virtual Environment and Installing Requirements ---")
    venv_dir = os.path.join(os.path.dirname(__file__), ".venv")
    
    if not os.path.exists(venv_dir):
        print("Creating virtual environment...")
        subprocess.run([sys.executable, "-m", "venv", venv_dir], check=True)
    else:
        print("Virtual environment already exists.")
        
    python_exec = get_python_exec()
    req_path = os.path.join(os.path.dirname(__file__), "requirements.txt")
    
    print("Installing dependencies...")
    try:
        subprocess.run([python_exec, "-m", "pip", "install", "-r", req_path], check=True)
        print("--- Requirements installed successfully! ---\n")
    except subprocess.CalledProcessError as e:
        print(f"Failed to install requirements. Error code: {e.returncode}\n")

def run_script(script_name):
    python_exec = get_python_exec()
    script_path = os.path.join(os.path.dirname(__file__), "scripts", script_name)
    
    if not os.path.exists(script_path):
        print(f"Error: Script {script_name} not found in the scripts/ folder!")
        return

    print(f"\n[{script_name}] Started...")
    try:
        subprocess.run([python_exec, script_path], check=True)
        print(f"[{script_name}] Completed successfully!\n")
    except subprocess.CalledProcessError as e:
        print(f"[{script_name}] Failed with error code {e.returncode}\n")
    except KeyboardInterrupt:
        print(f"\n[{script_name}] Execution interrupted by user.\n")

def main():
    while True:
        print("========================================")
        print(" Hakkutsu ML Pipeline Menu")
        print("========================================")
        print("1. Install Requirements (Setup .venv)")
        print("2. Download Data (01_download_data.py)")
        print("3. Preprocess Data (02_preprocess.py)")
        print("4. Run EDA (03_eda.py)")
        print("5. Run Full Pipeline (2 -> 3 -> 4)")
        print("0. Exit")
        print("========================================")
        
        choice = input("Select an option (0-5): ").strip()
        
        if choice == '1':
            install_requirements()
        elif choice == '2':
            run_script("01_download_data.py")
        elif choice == '3':
            run_script("02_preprocess.py")
        elif choice == '4':
            run_script("03_eda.py")
        elif choice == '5':
            run_script("01_download_data.py")
            run_script("02_preprocess.py")
            run_script("03_eda.py")
        elif choice == '0':
            print("Exiting...")
            break
        else:
            print("Invalid choice. Please select an option between 0 and 5.\n")

if __name__ == "__main__":
    main()
