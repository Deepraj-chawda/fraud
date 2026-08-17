from pyexiftool import exiftool
from utility import exiftool_exe


# Function to extract EXIF metadata
def extract_exif(filepath: str) -> dict:
    """
    Extract EXIF metadata from the uploaded image using ExifTool.

    Args:
        filepath (str): The file path to the uploaded image.

    Returns:
        dict: The structured EXIF metadata.
    """
    data = {}

    # List of metadata tags to ignore
    ignore = [
        "SourceFile",
        "ExifTool:ExifTool",
        "File:FileName",
        "File:Directory",
        "File:FileSize",
        "File:FileModifyDate",
        "File:FileInodeChangeDate",
        "File:FileAccessDate",
        "File:FileType",
        "File:FilePermissions",
        "File:FileTypeExtension",
        "File:MIMEType",
    ]

    # Extract metadata using exiftool
    with exiftool.ExifTool(exiftool_exe()) as et:
        metadata = et.get_metadata(filepath)

        for tag, value in metadata.items():
            if not value or any(t in tag for t in ignore):
                continue

            # Cleaning up the value
            value = str(value).replace(", use -b option to extract", "")
            value = value.replace("Binary data ", "Binary data: ")
            group, desc = tag.split(":")

            # Storing the extracted data in a structured format
            if group in data:
                data[group].append([desc, value])
            else:
                data[group] = [[desc, value]]

    return data
