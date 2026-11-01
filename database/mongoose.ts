import mongoose from "mongoose";

const MONGDB_URI = process.env.MONGO_URI;

declare global { 
    var mongooseCache: {
        conn: typeof mongoose | null;
        promise: Promise<typeof mongoose> | null;
    }
}

let cached = global.mongooseCache;

if (!cached) { 
    cached = global.mongooseCache = { conn: null, promise: null };
}

export const connectToDatabase = async () => { 
    if (!MONGDB_URI) throw new Error('Please define the MONGODB_URI environment variable inside .env.local');
    
    if (cached.conn) return cached.conn;
    
    if (!cached.promise) { 
        cached.promise = mongoose.connect(MONGDB_URI, { bufferCommands: false });
    }
    try {
        cached.conn = await cached.promise;
    } catch (err) {
        cached.promise = null;
        throw err;
    }

    console.log(`Connected to MongoDB ${process.env.NODE_ENV} ${MONGDB_URI}`);

    return cached.conn;
}
