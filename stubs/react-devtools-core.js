// Ink imports react-devtools-core only when the DEV environment variable is
// "true". That path is never taken here, and bundling the real package would
// add megabytes to a file that has to download quickly over npx, so the build
// aliases it to this stub.
export default { connectToDevTools() {} };
