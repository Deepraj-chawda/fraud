import os
import tempfile
from subprocess import run, PIPE
from utility import exiftool_exe


# Function to extract header structure
def extract_header(filepath: str) -> str:
    """
    Extract the HTML header structure from an image file using ExifTool.

    Args:
        filepath (str): The file path to the uploaded image.

    Returns:
        str: The HTML structure of the file's metadata.
    """
    temp_dir = tempfile.TemporaryDirectory()
    temp_file = os.path.join(temp_dir.name, "structure.html")

    # Running exiftool command to extract HTML structure
    p = run([exiftool_exe(), "-q", "-htmldump0", filepath], stdout=PIPE)

    with open(temp_file, "w") as file:
        file.write(p.stdout.decode("utf-8"))

    # Reading the generated HTML content
    with open(temp_file, "r") as file:
        html_content = file.read()

    return html_content
