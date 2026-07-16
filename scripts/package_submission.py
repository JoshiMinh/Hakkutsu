import os
import zipfile
import shutil
from pathlib import Path

def package_project():
    """
    Packages the Hakkutsu project for university submission.
    Excludes unnecessary environment folders, build artifacts, and heavy dependencies.
    """
    project_root = Path(__file__).parent.parent.absolute()
    output_filename = project_root / "Hakkutsu_Submission.zip"
    
    # Files and directories to explicitly include
    include_dirs = ['backend', 'extension', 'ml', 'docs']
    include_files = ['README.md', 'ROADMAP.md', 'package.json', 'pnpm-workspace.yaml']
    
    # Patterns and directories to exclude to keep file size reasonable
    exclude_dirs = {
        '.git', 
        'node_modules', 
        '.venv', 
        'venv', 
        '__pycache__', 
        '.plasmo', 
        'build', 
        'dist',
        '.pytest_cache',
        '.ipynb_checkpoints',
        '.agents'
    }
    
    exclude_extensions = {'.pyc', '.pyo', '.pyd', '.env', '.sqlite3'}

    print(f"Packaging project from: {project_root}")
    print(f"Output will be saved to: {output_filename}")
    
    # Using ZIP_DEFLATED for compression
    with zipfile.ZipFile(output_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        # 1. Add directories
        for dir_name in include_dirs:
            dir_path = project_root / dir_name
            if not dir_path.exists():
                print(f"Warning: Directory {dir_name} not found. Skipping.")
                continue
                
            for root, dirs, files in os.walk(dir_path):
                # Modifying dirs in-place to skip excluded directories
                dirs[:] = [d for d in dirs if d not in exclude_dirs]
                
                for file in files:
                    file_path = Path(root) / file
                    
                    # Skip files with excluded extensions
                    if file_path.suffix in exclude_extensions:
                        continue
                        
                    # Calculate the relative path for the zip archive
                    rel_path = file_path.relative_to(project_root)
                    zipf.write(file_path, rel_path)
                    print(f"Added: {rel_path}")

        # 2. Add root files
        for file_name in include_files:
            file_path = project_root / file_name
            if file_path.exists():
                zipf.write(file_path, file_name)
                print(f"Added: {file_name}")
            else:
                print(f"Warning: File {file_name} not found. Skipping.")
                
    print(f"\nSuccessfully packaged project into {output_filename}")
    print(f"Archive size: {os.path.getsize(output_filename) / (1024*1024):.2f} MB")

if __name__ == "__main__":
    package_project()
