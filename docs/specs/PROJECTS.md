# Projects

A project represents a set of application secrets stored in a restic repository.

## Restic repository settings

Each project is defined with the settings required to connect to a restic repository over an S3-compatible backend:

- [x] `Name` — project display name (unique)
- [x] `Description` — optional free text
- [x] `S3 Endpoint` — hostname of the S3-compatible endpoint
- [x] `S3 Bucket` — bucket name
- [x] `Repository Prefix` — path prefix inside the bucket (defaults to the project name slugified when empty)
- [x] `S3 Region` — optional, passed to restic as `s3.region`
- [x] `S3 Bucket Lookup` — optional, passed to restic as `s3.bucket-lookup` (defaults to `dns`)
- [x] `S3 Access Key ID` — sensitive
- [x] `S3 Secret Access Key` — sensitive
- [x] `Restic Password` — repository encryption password, sensitive

## Lifecycle

- [x] Projects can be created by admins
- [x] Projects can be deleted by admins (deleting also deletes the project secrets from the application database; the restic repository is left untouched)
- [x] Projects can never be updated: settings are immutable after creation

## Visibility

- [x] Admins see all projects
- [x] Regular users only see the projects they have been granted access to
- [x] Users without access to any project see an empty list

Last spec review: 2026-09-13
